import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock('@/lib/commandRouter', () => ({ routeCommand: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { routeCommand } from '@/lib/commandRouter';
import { sendMessage } from '@/lib/telegram';
import { POST } from '@/app/api/telegram/webhook/route';

function makeRequest(body: unknown, secret: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-telegram-bot-api-secret-token'] = secret;
  return new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/telegram/webhook', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'super-secret';
    vi.mocked(routeCommand).mockReset();
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rifiuta richieste senza il secret corretto', async () => {
    const req = makeRequest({ message: { chat: { id: 1 }, text: '/help' } }, 'sbagliato');
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(routeCommand).not.toHaveBeenCalled();
  });

  it('ignora update senza testo', async () => {
    const req = makeRequest({ message: { chat: { id: 1 } } }, 'super-secret');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(routeCommand).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('dispatcha il comando e invia la risposta via Telegram', async () => {
    vi.mocked(routeCommand).mockResolvedValue({ text: 'risposta di test' });
    const req = makeRequest({ message: { chat: { id: 100 }, text: '/help' } }, 'super-secret');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(routeCommand).toHaveBeenCalledWith({}, 100, '/help');
    expect(sendMessage).toHaveBeenCalledWith(100, 'risposta di test');
  });

  it('ritorna 400 se il corpo della richiesta non è JSON valido', async () => {
    const req = new NextRequest('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'super-secret' },
      body: 'non è json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(routeCommand).not.toHaveBeenCalled();
  });

  it('ritorna comunque 200 se routeCommand lancia un errore', async () => {
    vi.mocked(routeCommand).mockRejectedValue(new Error('errore interno'));
    const req = makeRequest({ message: { chat: { id: 100 }, text: '/help' } }, 'super-secret');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ritorna comunque 200 se sendMessage lancia un errore', async () => {
    vi.mocked(routeCommand).mockResolvedValue({ text: 'risposta di test' });
    vi.mocked(sendMessage).mockRejectedValue(new Error('telegram giù'));
    const req = makeRequest({ message: { chat: { id: 100 }, text: '/help' } }, 'super-secret');
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
