import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('telegram client', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'super-secret';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invia un messaggio con il testo corretto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(42, 'ciao');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat_id: 42, text: 'ciao' }),
      })
    );
  });

  it('lancia un errore se Telegram risponde con errore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { sendMessage } = await import('@/lib/telegram');
    await expect(sendMessage(42, 'ciao')).rejects.toThrow('Telegram sendMessage fallita (status 400)');
  });

  it('verifica correttamente il secret del webhook', async () => {
    const { verifyWebhookSecret } = await import('@/lib/telegram');
    expect(verifyWebhookSecret('super-secret')).toBe(true);
    expect(verifyWebhookSecret('sbagliato')).toBe(false);
    expect(verifyWebhookSecret(null)).toBe(false);
  });

  it('lancia un errore se TELEGRAM_BOT_TOKEN non è impostato', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    vi.stubGlobal('fetch', vi.fn());
    const { sendMessage } = await import('@/lib/telegram');
    await expect(sendMessage(42, 'ciao')).rejects.toThrow('TELEGRAM_BOT_TOKEN mancante');
  });

  it('rifiuta un secret della stessa lunghezza ma con contenuto diverso', async () => {
    const { verifyWebhookSecret } = await import('@/lib/telegram');
    expect(verifyWebhookSecret('super-secre1')).toBe(false);
  });

  it('include reply_markup quando fornito a sendMessage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(42, 'scegli', {
      inline_keyboard: [[{ text: 'Approva', callback_data: 'proposal:1:approve' }]],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: 42,
          text: 'scegli',
          reply_markup: { inline_keyboard: [[{ text: 'Approva', callback_data: 'proposal:1:approve' }]] },
        }),
      })
    );
  });

  it('ritorna il message_id restituito da Telegram', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    const messageId = await sendMessage(42, 'ciao');

    expect(messageId).toBe(555);
  });

  it('ritorna undefined se la risposta Telegram non ha un body JSON valido', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    const messageId = await sendMessage(42, 'ciao');

    expect(messageId).toBeUndefined();
  });

  it('non include reply_markup se non fornito', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(42, 'ciao');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({ body: JSON.stringify({ chat_id: 42, text: 'ciao' }) })
    );
  });

  it('answerCallbackQuery chiama l\'API corretta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { answerCallbackQuery } = await import('@/lib/telegram');
    await answerCallbackQuery('cbq-1', 'fatto');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/answerCallbackQuery',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ callback_query_id: 'cbq-1', text: 'fatto' }),
      })
    );
  });

  it('answerCallbackQuery lancia un errore se Telegram risponde con errore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { answerCallbackQuery } = await import('@/lib/telegram');
    await expect(answerCallbackQuery('cbq-1')).rejects.toThrow(
      'Telegram answerCallbackQuery fallita (status 400)'
    );
  });
});
