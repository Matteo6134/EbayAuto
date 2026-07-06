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

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN mancante');
  }
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  const res = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage fallita (status ${res.status})`);
  }
}

export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  return Boolean(expected) && headerValue === expected;
}
