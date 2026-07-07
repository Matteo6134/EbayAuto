import { timingSafeEqual } from 'crypto';

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: { id: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN mancante');
  }
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  const res = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage fallita (status ${res.status})`);
  }
}

export async function editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  const res = await fetch(apiUrl('editMessageText'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram editMessageText fallita (status ${res.status})`);
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const res = await fetch(apiUrl('answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram answerCallbackQuery fallita (status ${res.status})`);
  }
}

export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !headerValue) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const headerBuffer = Buffer.from(headerValue);
  if (expectedBuffer.length !== headerBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, headerBuffer);
}
