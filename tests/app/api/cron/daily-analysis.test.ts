import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase } from '../../../helpers/fakeSupabase';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/metricsCollector', () => ({ collectDailyMetrics: vi.fn() }));
vi.mock('@/lib/proposalGenerator', () => ({
  generateAndSendProposals: vi.fn(),
  expireStalePendingProposals: vi.fn(),
}));
vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn(), getDashboardUrl: vi.fn(() => 'https://example.test/dashboard') };
});

import { getSupabaseClient } from '@/lib/supabase';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals, expireStalePendingProposals } from '@/lib/proposalGenerator';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { sendMessage } from '@/lib/telegram';
import { GET } from '@/app/api/cron/daily-analysis/route';

function makeRequest(authHeader: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  return new NextRequest('http://localhost/api/cron/daily-analysis', { headers });
}

const DASHBOARD_MARKUP = {
  inline_keyboard: [[{ text: '📊 Apri Dashboard', web_app: { url: 'https://example.test/dashboard' } }]],
};

const TODAY = new Date().toISOString().slice(0, 10);

describe('GET /api/cron/daily-analysis', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.TELEGRAM_OWNER_CHAT_ID = '210039451';
    vi.mocked(getSupabaseClient).mockReset();
    vi.mocked(collectDailyMetrics).mockReset();
    vi.mocked(generateAndSendProposals).mockReset();
    vi.mocked(expireStalePendingProposals).mockReset().mockResolvedValue(0);
    vi.mocked(refreshAccessToken).mockReset().mockResolvedValue({
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      accessTokenExpiresAt: new Date().toISOString(),
    });
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('ritorna 401 se il secret non corrisponde', async () => {
    const res = await GET(makeRequest('Bearer sbagliato'));
    expect(res.status).toBe(401);
    expect(collectDailyMetrics).not.toHaveBeenCalled();
  });

  it('raccoglie le metriche, scade le proposte stantie, genera le proposte e manda il recap con il bottone dashboard', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 1, errors: [] });
    vi.mocked(generateAndSendProposals).mockResolvedValue({ sent: 1, informational: [] });
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A' }], error: null }, // watched_listings attivi
      { data: { refresh_token: 'stored-refresh-token' }, error: null }, // ebay_connection (rinnovo unico)
      {
        data: [
          { metric_date: TODAY, watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 1
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(collectDailyMetrics).toHaveBeenCalledWith(supabase, 210039451);
    expect(expireStalePendingProposals).toHaveBeenCalledWith(supabase);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1); // hoisted: once per run, not per listing
    expect(generateAndSendProposals).toHaveBeenCalledWith(
      supabase,
      210039451,
      1,
      expect.objectContaining({ listingId: 1 }),
      'fake-access-token'
    );
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Recap giornaliero'),
      DASHBOARD_MARKUP
    );
  });

  it('rinnova il token una sola volta anche con più prodotti monitorati', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 2, errors: [] });
    vi.mocked(generateAndSendProposals).mockResolvedValue({ sent: 1, informational: [] });

    const supabase = createFakeSupabase([
      {
        data: [
          { id: 1, title: 'Prodotto A' },
          { id: 2, title: 'Prodotto B' },
        ],
        error: null,
      }, // watched_listings attivi
      { data: { refresh_token: 'stored-refresh-token' }, error: null }, // ebay_connection (rinnovo unico)
      {
        data: [{ metric_date: TODAY, watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null }],
        error: null,
      }, // storico daily_metrics prodotto 1
      {
        data: [{ metric_date: TODAY, watch_count: 5, quantity_sold: 0, revenue: 0, price: 12, ad_rate_percent: null }],
        error: null,
      }, // storico daily_metrics prodotto 2
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(generateAndSendProposals).toHaveBeenCalledTimes(2);
  });

  it('salta un prodotto se l\'ultima riga di daily_metrics non è di oggi', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 1, errors: [] });
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A' }], error: null }, // watched_listings attivi
      { data: { refresh_token: 'stored-refresh-token' }, error: null }, // ebay_connection
      {
        data: [
          { metric_date: '2020-01-01', watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics: ultima riga NON è di oggi
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(generateAndSendProposals).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(210039451, expect.any(String), DASHBOARD_MARKUP);
  });

  it('isola il fallimento della generazione proposte di un prodotto: gli altri non sono impattati', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 2, errors: [] });
    vi.mocked(generateAndSendProposals)
      .mockRejectedValueOnce(new Error('salvataggio proposta fallito'))
      .mockResolvedValueOnce({ sent: 1, informational: [] });

    const supabase = createFakeSupabase([
      {
        data: [
          { id: 1, title: 'Prodotto A' },
          { id: 2, title: 'Prodotto B' },
        ],
        error: null,
      }, // watched_listings attivi
      { data: { refresh_token: 'stored-refresh-token' }, error: null }, // ebay_connection (rinnovo unico)
      {
        data: [
          { metric_date: TODAY, watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 1
      {
        data: [
          { metric_date: TODAY, watch_count: 5, quantity_sold: 0, revenue: 0, price: 12, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 2
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(generateAndSendProposals).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Prodotto A'),
      DASHBOARD_MARKUP
    );
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Prodotto B'),
      DASHBOARD_MARKUP
    );
    expect(console.error).toHaveBeenCalled();
  });

  it('include impression/click/CTR nel recap quando i dati Analytics sono disponibili, con trend vs ieri', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 1, errors: [] });
    vi.mocked(generateAndSendProposals).mockResolvedValue({ sent: 0, informational: [] });
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Mercedes W177' }], error: null }, // watched_listings attivi
      { data: { refresh_token: 'stored-refresh-token' }, error: null }, // ebay_connection
      {
        data: [
          {
            metric_date: '2026-07-07',
            watch_count: 14,
            quantity_sold: 0,
            revenue: 0,
            price: 18,
            ad_rate_percent: null,
            impression_count: 200,
            click_count: 40,
            click_through_rate: 1.2,
          },
          {
            metric_date: TODAY,
            watch_count: 16,
            quantity_sold: 0,
            revenue: 0,
            price: 18,
            ad_rate_percent: null,
            impression_count: 224,
            click_count: 53,
            click_through_rate: 1.0,
          },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 1 (ieri + oggi, entrambi con analytics)
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('👁 224 impression · 53 click (CTR 1.0%) · 16 osservatori · 0 venduti (impression +12% vs ieri)'),
      DASHBOARD_MARKUP
    );
  });

  it('ricade sulla riga solo-osservatori nel recap quando i dati Analytics non sono disponibili', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 1, errors: [] });
    vi.mocked(generateAndSendProposals).mockResolvedValue({ sent: 0, informational: [] });
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto Senza Analytics' }], error: null },
      { data: { refresh_token: 'stored-refresh-token' }, error: null },
      {
        data: [
          {
            metric_date: TODAY,
            watch_count: 5,
            quantity_sold: 0,
            revenue: 0,
            price: 18,
            ad_rate_percent: null,
            impression_count: null,
            click_count: null,
            click_through_rate: null,
          },
        ],
        error: null,
      },
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('5 osservatori (n/d vs media), 0 venduti'),
      DASHBOARD_MARKUP
    );
  });
});
