import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({ reviseListingField: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { reviseListingField } from '@/lib/ebayRevise';
import { handleSetBestOffer } from '@/lib/commands/setbestoffer';

describe('handleSetBestOffer', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(reviseListingField).mockReset();
  });

  it('mostra il messaggio di uso se manca l\'id', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetBestOffer({ supabase, chatId: 1, args: '' });
    expect(result.text).toBe('Uso: /setbestoffer <id> [autoaccetta=<prezzo>] [minimo=<prezzo>]');
    expect(reviseListingField).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se un token non è valido', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetBestOffer({ supabase, chatId: 1, args: '18 pippo=5' });
    expect(result.text).toBe('Uso: /setbestoffer <id> [autoaccetta=<prezzo>] [minimo=<prezzo>]');
  });

  it('segnala se il prezzo minimo non è inferiore a quello di auto-accettazione', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetBestOffer({
      supabase,
      chatId: 1,
      args: '18 autoaccetta=12 minimo=12',
    });
    expect(result.text).toBe('Il prezzo minimo deve essere inferiore a quello di auto-accettazione.');
    expect(reviseListingField).not.toHaveBeenCalled();
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleSetBestOffer({ supabase, chatId: 1, args: '99' });
    expect(result.text).toBe('Nessun prodotto trovato con id 99.');
  });

  it('segnala se non c\'è un account eBay collegato', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1', title: 'Trapano Bosch' }, error: null },
      { data: null, error: null },
    ]);
    const result = await handleSetBestOffer({ supabase, chatId: 1, args: '1' });
    expect(result.text).toBe('Nessun account eBay collegato. Usa /connectebay.');
  });

  it('attiva la proposta d\'acquisto senza prezzi', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseListingField).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 18, ebay_item_id: 'ITEM18', title: 'Trapano Bosch' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetBestOffer({ supabase, chatId: 1, args: '18' });

    expect(reviseListingField).toHaveBeenCalledTimes(1);
    const [accessToken, itemId, xml] = vi.mocked(reviseListingField).mock.calls[0];
    expect(accessToken).toBe('access-1');
    expect(itemId).toBe('ITEM18');
    expect(xml).toContain('<BestOfferEnabled>true</BestOfferEnabled>');
    expect(xml).not.toContain('ListingDetails');

    expect(result.text).toBe("✅ Proposta d'acquisto attivata su Trapano Bosch.");
  });

  it('attiva la proposta d\'acquisto con auto-accetta e minimo', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseListingField).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 18, ebay_item_id: 'ITEM18', title: 'Trapano Bosch' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetBestOffer({
      supabase,
      chatId: 1,
      args: '18 autoaccetta=16.50 minimo=12',
    });

    expect(reviseListingField).toHaveBeenCalledTimes(1);
    const [, , xml] = vi.mocked(reviseListingField).mock.calls[0];
    expect(xml).toContain('<BestOfferEnabled>true</BestOfferEnabled>');
    expect(xml).toContain('<BestOfferAutoAcceptPrice>16.50</BestOfferAutoAcceptPrice>');
    expect(xml).toContain('<MinimumBestOfferPrice>12.00</MinimumBestOfferPrice>');

    expect(result.text).toBe(
      "✅ Proposta d'acquisto attivata su Trapano Bosch. Auto-accetta da €16.50. Rifiuta sotto €12.00."
    );
  });

  it('funziona con i parametri prezzo in ordine inverso', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseListingField).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 18, ebay_item_id: 'ITEM18', title: 'Trapano Bosch' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetBestOffer({
      supabase,
      chatId: 1,
      args: '18 minimo=12 autoaccetta=16.50',
    });

    const [, , xml] = vi.mocked(reviseListingField).mock.calls[0];
    expect(xml).toContain('<BestOfferAutoAcceptPrice>16.50</BestOfferAutoAcceptPrice>');
    expect(xml).toContain('<MinimumBestOfferPrice>12.00</MinimumBestOfferPrice>');
    expect(result.text).toContain('Auto-accetta da €16.50');
    expect(result.text).toContain('Rifiuta sotto €12.00');
  });

  it('restituisce l\'errore eBay se reviseListingField fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseListingField).mockRejectedValue(
      new Error('ReviseItem ha restituito un errore: Best Offer non disponibile per inserzioni con varianti')
    );
    const supabase = createFakeSupabase([
      { data: { id: 18, ebay_item_id: 'ITEM18', title: 'Trapano Bosch' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetBestOffer({ supabase, chatId: 1, args: '18' });

    expect(result.text).toBe(
      'ReviseItem ha restituito un errore: Best Offer non disponibile per inserzioni con varianti'
    );
  });
});
