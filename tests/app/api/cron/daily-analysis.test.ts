import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase } from '../../../helpers/fakeSupabase';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/metricsCollector', () => ({ collectDailyMetrics: vi.fn() }));
vi.mock('@/lib/proposalGenerator', () => ({ generateAndSendProposals: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { getSupabaseClient } from '@/lib/supabase';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import { sendMessage } from '@/lib/telegram';
import { GET } from '@/app/api/cron/daily-analysis/route';

function makeRequest(authHeader: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  return new NextRequest('http://localhost/api/cron/daily-analysis', { headers });
}

describe('GET /api/cron/daily-analysis', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.TELEGRAM_OWNER_CHAT_ID = '210039451';
    vi.mocked(getSupabaseClient).mockReset();
    vi.mocked(collectDailyMetrics).mockReset();
    vi.mocked(generateAndSendProposals).mockReset();
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('ritorna 401 se il secret non corrisponde', async () => {
    const res = await GET(makeRequest('Bearer sbagliato'));
    expect(res.status).toBe(401);
    expect(collectDailyMetrics).not.toHaveBeenCalled();
  });

  it('raccoglie le metriche, genera le proposte e manda il recap', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 1, errors: [] });
    vi.mocked(generateAndSendProposals).mockResolvedValue({ sent: 1, informational: [] });
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A' }], error: null }, // watched_listings attivi
      {
        data: [
          { metric_date: '2026-07-01', watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 1
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(collectDailyMetrics).toHaveBeenCalledWith(supabase, 210039451);
    expect(sendMessage).toHaveBeenCalledWith(210039451, expect.stringContaining('Recap giornaliero'));
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
      {
        data: [
          { metric_date: '2026-07-01', watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 1
      {
        data: [
          { metric_date: '2026-07-01', watch_count: 5, quantity_sold: 0, revenue: 0, price: 12, ad_rate_percent: null },
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
      expect.stringContaining('Prodotto A')
    );
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Prodotto B')
    );
    expect(console.error).toHaveBeenCalled();
  });
});
