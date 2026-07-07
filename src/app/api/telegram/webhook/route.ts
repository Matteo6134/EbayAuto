import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { routeCommand, isAuthorized } from '@/lib/commandRouter';
import { sendMessage, answerCallbackQuery, verifyWebhookSecret, TelegramUpdate } from '@/lib/telegram';
import { handleCallback } from '@/lib/callbackHandler';
import { editMessageText } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!verifyWebhookSecret(secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (err) {
    console.error('Telegram webhook: corpo della richiesta non valido', err);
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const callbackQuery = update.callback_query;
  if (callbackQuery?.data && callbackQuery.from?.id) {
    try {
      await answerCallbackQuery(callbackQuery.id);
      if (isAuthorized(callbackQuery.from.id)) {
        const supabase = getSupabaseClient();
        const result = await handleCallback(supabase, callbackQuery.data, callbackQuery.from.id);
        if (result) {
          const targetChatId = result.chatId || callbackQuery.from.id;
          if (result.editMessage && callbackQuery.message?.message_id) {
            await editMessageText(targetChatId, callbackQuery.message.message_id, result.text, result.replyMarkup);
          } else {
            await sendMessage(targetChatId, result.text, result.replyMarkup);
          }
        }
      }
    } catch (err) {
      console.error('Telegram webhook: errore nella gestione del callback', err);
    }
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  try {
    const supabase = getSupabaseClient();
    const result = await routeCommand(supabase, message.chat.id, message.text);
    await sendMessage(message.chat.id, result.text, result.replyMarkup);
  } catch (err) {
    console.error('Telegram webhook: errore durante la gestione del comando', err);
  }

  return NextResponse.json({ ok: true });
}
