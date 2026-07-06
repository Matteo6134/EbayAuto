import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayTrading', () => ({ getSellingSnapshot: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { getSellingSnapshot } from '@/lib/ebayTrading';
import { collectDailyMetrics } from '@/lib/metricsCollector';

describe('collectDailyMetrics', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(getSellingSnapshot).mockReset();
  });

  it('ritorna 0 raccolte se non c\'è nessun collegamento eBay', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await collectDailyMetrics(supabase, 210039451);
    expect(result).toEqual({ collected: 0, errors: [] });
    expect(getSellingSnapshot).not.toHaveBeenCalled();
  });

  it('salva le metriche per ogni prodotto monitorato trovato nello snapshot eBay', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getSellingSnapshot).mockResolvedValue({
      listings: [{ itemId: 'AAA', title: 'Prodotto A', categoryId: '1', watchCount: 5, price: 10 }],
      soldItems: [{ itemId: 'AAA', quantitySold: 2, revenue: 20 }],
    });
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null }, // ebay_connection
      { data: [{ id: 1, ebay_item_id: 'AAA' }], error: null }, // watched_listings attivi
      { data: null, error: null }, // upsert daily_metrics
    ]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result).toEqual({ collected: 1, errors: [] });
  });

  it('salta i prodotti monitorati non trovati nello snapshot e lo segnala come errore', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getSellingSnapshot).mockResolvedValue({ listings: [], soldItems: [] });
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: [{ id: 1, ebay_item_id: 'AAA', title: 'Prodotto A' }], error: null },
    ]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result.collected).toBe(0);
    expect(result.errors).toEqual(['Prodotto Prodotto A: non trovato tra le inserzioni attive eBay']);
  });

  it('segnala un errore se il rinnovo del token fallisce, senza interrompere', async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error('refresh non valido'));
    const supabase = createFakeSupabase([{ data: { refresh_token: 'rt-1' }, error: null }]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result).toEqual({ collected: 0, errors: ['Rinnovo token eBay fallito: refresh non valido'] });
  });

  it('segnala un errore se il salvataggio delle metriche fallisce, senza contarlo come raccolto', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getSellingSnapshot).mockResolvedValue({
      listings: [{ itemId: 'AAA', title: 'Prodotto A', categoryId: '1', watchCount: 5, price: 10 }],
      soldItems: [],
    });
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null }, // ebay_connection
      { data: [{ id: 1, ebay_item_id: 'AAA', title: 'Prodotto A' }], error: null }, // watched_listings attivi
      { data: null, error: { message: 'constraint violata' } }, // upsert daily_metrics fallito
    ]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result).toEqual({
      collected: 0,
      errors: ['Prodotto Prodotto A: salvataggio metriche fallito (constraint violata)'],
    });
  });
});
