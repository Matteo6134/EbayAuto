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
});
