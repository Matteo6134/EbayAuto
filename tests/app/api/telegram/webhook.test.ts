import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock('@/lib/commandRouter', () => ({ routeCommand: vi.fn(), isAuthorized: vi.fn((chatId: number) => String(chatId) === '100') }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn(), answerCallbackQuery: vi.fn() };
});
vi.mock('@/lib/callbackHandler', () => ({ handleProposalCallback: vi.fn() }));

import { routeCommand } from '@/lib/commandRouter';
import { sendMessage, answerCallbackQuery } from '@/lib/telegram';
import { handleProposalCallback } from '@/lib/callbackHandler';
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
    process.env.TELEGRAM_OWNER_CHAT_ID = '100';
    vi.mocked(routeCommand).mockReset();
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
    vi.mocked(answerCallbackQuery).mockReset().mockResolvedValue(undefined);
    vi.mocked(handleProposalCallback).mockReset();
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

  it('gestisce un callback_query: risponde subito e poi manda il messaggio', async () => {
    vi.mocked(handleProposalCallback).mockResolvedValue({ chatId: 100, text: 'Fatto' });
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 100 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(handleProposalCallback).toHaveBeenCalledWith({}, 'proposal:1:approve');
    expect(sendMessage).toHaveBeenCalledWith(100, 'Fatto');
  });

  it('ignora i callback_query da chat non autorizzate', async () => {
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 999 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(handleProposalCallback).not.toHaveBeenCalled();
  });

  it('non fallisce se handleProposalCallback lancia un errore', async () => {
    vi.mocked(handleProposalCallback).mockRejectedValue(new Error('errore interno'));
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 100 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
  });

  it('non fallisce se answerCallbackQuery lancia un errore', async () => {
    vi.mocked(answerCallbackQuery).mockRejectedValue(new Error('telegram giù'));
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 100 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(handleProposalCallback).not.toHaveBeenCalled();
  });

  it('usa il chat_id di chi ha premuto il bottone se handleProposalCallback non ne conosce uno reale (es. proposta non trovata)', async () => {
    vi.mocked(handleProposalCallback).mockResolvedValue({ chatId: 0, text: 'Proposta non trovata.' });
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:999:approve', from: { id: 100 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(100, 'Proposta non trovata.');
  });
});
