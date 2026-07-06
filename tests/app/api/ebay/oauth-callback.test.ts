import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/ebayOAuth', () => ({ exchangeCodeForTokens: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { getSupabaseClient } from '@/lib/supabase';
import { exchangeCodeForTokens } from '@/lib/ebayOAuth';
import { sendMessage } from '@/lib/telegram';
import { GET } from '@/app/api/ebay/oauth/callback/route';

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/ebay/oauth/callback${query}`);
}

function fakeSupabaseForCallback(lookupResult: { data: any; error: any }) {
  const builder: any = {
    from: () => builder,
    select: () => builder,
    update: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(lookupResult),
    then: (resolve: any) => resolve({ data: null, error: null }),
  };
  return builder;
}

describe('GET /api/ebay/oauth/callback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exchangeCodeForTokens).mockReset();
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ritorna 400 se mancano code o state', async () => {
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('ritorna 400 se lo state non corrisponde a nessun collegamento in attesa', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(fakeSupabaseForCallback({ data: null, error: null }));
    const res = await GET(makeRequest('?code=abc&state=unknown'));
    expect(res.status).toBe(400);
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('scambia il code, salva i token e notifica su Telegram', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(fakeSupabaseForCallback({ data: { chat_id: 210039451 }, error: null }));
    vi.mocked(exchangeCodeForTokens).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });

    const res = await GET(makeRequest('?code=abc123&state=known-state'));

    expect(res.status).toBe(200);
    expect(exchangeCodeForTokens).toHaveBeenCalledWith('abc123');
    expect(sendMessage).toHaveBeenCalledWith(210039451, expect.stringContaining('collegato'));
  });

  it('ritorna 500 e non manda messaggi se lo scambio del token fallisce', async () => {
    vi.mocked(getSupabaseClient).mockReturnValue(fakeSupabaseForCallback({ data: { chat_id: 210039451 }, error: null }));
    vi.mocked(exchangeCodeForTokens).mockRejectedValue(new Error('scambio fallito'));

    const res = await GET(makeRequest('?code=abc123&state=known-state'));

    expect(res.status).toBe(500);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
