import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayTrading', () => ({ getActiveListings: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { getActiveListings } from '@/lib/ebayTrading';
import { handleScanProducts } from '@/lib/commands/scanproducts';

describe('handleScanProducts', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(getActiveListings).mockReset();
  });

  it('chiede di collegare eBay se non c\'è nessun refresh token salvato', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleScanProducts({ supabase, chatId: 210039451, args: '' });
    expect(result.text).toContain('Nessun account eBay collegato');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('segnala un errore se la lettura del collegamento fallisce', async () => {
    const supabase = createFakeSupabase([{ data: null, error: { message: 'db down' } }]);
    const result = await handleScanProducts({ supabase, chatId: 210039451, args: '' });
    expect(result.text).toContain('Errore nel recuperare il collegamento eBay: db down');
  });

  it('segnala un errore se il rinnovo del token fallisce', async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error('refresh token non valido'));
    const supabase = createFakeSupabase([{ data: { refresh_token: 'rt-1' }, error: null }]);
    const result = await handleScanProducts({ supabase, chatId: 210039451, args: '' });
    expect(result.text).toContain('Errore nel rinnovare il collegamento eBay: refresh token non valido');
  });

  it('segnala un errore se la lettura delle inserzioni da eBay fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getActiveListings).mockRejectedValue(new Error('eBay non risponde'));
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: null, error: null },
    ]);
    const result = await handleScanProducts({ supabase, chatId: 210039451, args: '' });
    expect(result.text).toContain('Errore nel leggere le inserzioni da eBay: eBay non risponde');
  });

  it('aggiunge solo le inserzioni non ancora monitorate e riporta il conteggio', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getActiveListings).mockResolvedValue([
      { itemId: 'AAA', title: 'Prodotto A', categoryId: '1' },
      { itemId: 'BBB', title: 'Prodotto B', categoryId: '2' },
      { itemId: 'CCC', title: 'Prodotto C', categoryId: '3' },
    ]);
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null }, // lookup connessione
      { data: null, error: null }, // update token
      { data: [{ ebay_item_id: 'AAA' }], error: null }, // prodotti già monitorati
      { data: null, error: null }, // insert Prodotto B
      { data: null, error: null }, // insert Prodotto C
    ]);

    const result = await handleScanProducts({ supabase, chatId: 210039451, args: '' });

    expect(result.text).toBe(
      'Scansione completata: 3 inserzioni trovate, 2 aggiunte al monitoraggio (1 già presenti).'
    );
  });

  it('segnala un errore se il salvataggio di una nuova inserzione fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getActiveListings).mockResolvedValue([{ itemId: 'AAA', title: 'Prodotto A', categoryId: '1' }]);
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: null, error: null },
      { data: [], error: null },
      { data: null, error: { message: 'insert fallito' } },
    ]);

    const result = await handleScanProducts({ supabase, chatId: 210039451, args: '' });

    expect(result.text).toContain('Errore nel salvare "Prodotto A": insert fallito');
  });
});
