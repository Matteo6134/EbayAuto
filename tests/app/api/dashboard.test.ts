import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';

const BOT_TOKEN = 'bot-token';

function buildInitData(overrides: Record<string, string> = {}, authDateOverride?: number) {
  const authDate = authDateOverride ?? Math.floor(Date.now() / 1000);
  const params: Record<string, string> = {
    auth_date: String(authDate),
    user: JSON.stringify({ id: 210039451 }),
    ...overrides,
  };
  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const search = new URLSearchParams({ ...params, hash });
  return search.toString();
}

function fakeSupabaseBuilder(defaultData: any = []) {
  const builder: any = {
    from: () => builder,
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: any) => resolve({ data: defaultData, error: null }),
  };
  return builder;
}

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: any[]) => createClientMock(...args),
}));

describe('GET /api/dashboard', () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockReset();
    createClientMock.mockReturnValue(fakeSupabaseBuilder([]));
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  afterEach(() => {
    vi.unstubAllEnvs?.();
  });

  it('usa SUPABASE_URL quando è impostata', async () => {
    process.env.SUPABASE_URL = 'https://primary.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://public.supabase.co';
    const { GET } = await import('@/app/api/dashboard/route');

    const initData = buildInitData();
    const req = new NextRequest(`http://localhost/api/dashboard?initData=${encodeURIComponent(initData)}`);
    await GET(req);

    expect(createClientMock).toHaveBeenCalledWith('https://primary.supabase.co', 'service-role-key');
  });

  it('usa NEXT_PUBLIC_SUPABASE_URL come fallback se SUPABASE_URL non è impostata', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://public.supabase.co';
    const { GET } = await import('@/app/api/dashboard/route');

    const initData = buildInitData();
    const req = new NextRequest(`http://localhost/api/dashboard?initData=${encodeURIComponent(initData)}`);
    await GET(req);

    expect(createClientMock).toHaveBeenCalledWith('https://public.supabase.co', 'service-role-key');
  });

  it('ritorna 401 se initData ha un hash non valido', async () => {
    process.env.SUPABASE_URL = 'https://primary.supabase.co';
    const { GET } = await import('@/app/api/dashboard/route');

    const req = new NextRequest('http://localhost/api/dashboard?initData=hash=deadbeef');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('ritorna 401 se auth_date è più vecchio di 24 ore (replay)', async () => {
    process.env.SUPABASE_URL = 'https://primary.supabase.co';
    const { GET } = await import('@/app/api/dashboard/route');

    const staleAuthDate = Math.floor(Date.now() / 1000) - 25 * 60 * 60; // 25h fa
    const initData = buildInitData({}, staleAuthDate);
    const req = new NextRequest(`http://localhost/api/dashboard?initData=${encodeURIComponent(initData)}`);
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('accetta initData con auth_date recente', async () => {
    process.env.SUPABASE_URL = 'https://primary.supabase.co';
    const { GET } = await import('@/app/api/dashboard/route');

    const initData = buildInitData();
    const req = new NextRequest(`http://localhost/api/dashboard?initData=${encodeURIComponent(initData)}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
  });
});
