import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { routeCommand } from '@/lib/commandRouter';
import { sendMessage, verifyWebhookSecret, TelegramUpdate } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!verifyWebhookSecret(secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json()) as TelegramUpdate;
  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabaseClient();
  const result = await routeCommand(supabase, message.chat.id, message.text);
  await sendMessage(message.chat.id, result.text);

  return NextResponse.json({ ok: true });
}
