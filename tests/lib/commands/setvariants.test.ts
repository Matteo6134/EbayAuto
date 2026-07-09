import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({
  getExistingItemDetails: vi.fn(),
  reviseWithVariations: vi.fn(),
}));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { getExistingItemDetails, reviseWithVariations } from '@/lib/ebayRevise';
import { handleSetVariants } from '@/lib/commands/setvariants';

const USAGE_TEXT = 'Uso: /setvariants <id> <NomeOpzione>; <Valore>=<prezzo>; <Valore>=<prezzo>';

describe('handleSetVariants', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(getExistingItemDetails).mockReset();
    vi.mocked(reviseWithVariations).mockReset();
  });

  it('mostra il messaggio di uso se manca il nome opzione', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetVariants({ supabase, chatId: 1, args: '17' });
    expect(result.text).toBe(USAGE_TEXT);
    expect(reviseWithVariations).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se ci sono meno di 2 varianti', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=88.83',
    });
    expect(result.text).toBe(USAGE_TEXT);
    expect(reviseWithVariations).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se un prezzo non è valido', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=abc; Senza lampadina=60',
    });
    expect(result.text).toBe(USAGE_TEXT);
    expect(reviseWithVariations).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se un prezzo è zero o negativo', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=0; Senza lampadina=60',
    });
    expect(result.text).toBe(USAGE_TEXT);
  });

  it('mostra il messaggio di uso se il primo segmento contiene un simbolo =', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina=1; Con lampadina=88.83; Senza lampadina=60',
    });
    expect(result.text).toBe(USAGE_TEXT);
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '99 Lampadina; Con lampadina=88.83; Senza lampadina=60',
    });
    expect(result.text).toBe('Nessun prodotto trovato con id 99.');
  });

  it('segnala se non c\'è un account eBay collegato', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 17, ebay_item_id: 'ITEM1' }, error: null },
      { data: null, error: null },
    ]);
    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=88.83; Senza lampadina=60',
    });
    expect(result.text).toBe('Nessun account eBay collegato. Usa /connectebay.');
  });

  it('segnala se l\'inserzione ha già vendite senza tentare la conversione', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getExistingItemDetails).mockResolvedValue({
      conditionId: '1000',
      title: 'Lampada da tavolo',
      specifics: [],
      quantity: 5,
      quantitySold: 2,
    });
    const supabase = createFakeSupabase([
      { data: { id: 17, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=88.83; Senza lampadina=60',
    });

    expect(result.text).toBe(
      '⚠️ Questa inserzione ha già vendite: eBay non permette di convertirla in inserzione con varianti. Serve una nuova inserzione.'
    );
    expect(reviseWithVariations).not.toHaveBeenCalled();
  });

  it('crea le varianti con successo usando la quantità esistente', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getExistingItemDetails).mockResolvedValue({
      conditionId: '1000',
      title: 'Lampada da tavolo',
      specifics: [],
      quantity: 3,
      quantitySold: 0,
    });
    vi.mocked(reviseWithVariations).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 17, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=88.83; Senza lampadina=60',
    });

    expect(reviseWithVariations).toHaveBeenCalledWith(
      'access-1',
      'ITEM1',
      'Lampadina',
      [
        { value: 'Con lampadina', price: 88.83 },
        { value: 'Senza lampadina', price: 60 },
      ],
      3
    );
    expect(result.text).toContain('✅ Varianti create per Lampada da tavolo');
    expect(result.text).toContain('Con lampadina €88.83');
    expect(result.text).toContain('Senza lampadina €60.00');
    expect(result.text).toContain('proposte automatiche di prezzo');
  });

  it('usa quantità minima 1 se getExistingItemDetails non restituisce dettagli', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getExistingItemDetails).mockResolvedValue(null);
    vi.mocked(reviseWithVariations).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 17, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=88.83; Senza lampadina=60',
    });

    expect(reviseWithVariations).toHaveBeenCalledWith(
      'access-1',
      'ITEM1',
      'Lampadina',
      [
        { value: 'Con lampadina', price: 88.83 },
        { value: 'Senza lampadina', price: 60 },
      ],
      1
    );
    expect(result.text).toContain('✅ Varianti create per inserzione 17');
  });

  it('restituisce l\'errore eBay se reviseWithVariations fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getExistingItemDetails).mockResolvedValue({
      conditionId: '1000',
      title: 'Lampada da tavolo',
      specifics: [],
      quantity: 3,
      quantitySold: 0,
    });
    vi.mocked(reviseWithVariations).mockRejectedValue(
      new Error('ReviseFixedPriceItem ha restituito un errore: varianti non valide')
    );
    const supabase = createFakeSupabase([
      { data: { id: 17, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetVariants({
      supabase,
      chatId: 1,
      args: '17 Lampadina; Con lampadina=88.83; Senza lampadina=60',
    });

    expect(result.text).toBe('ReviseFixedPriceItem ha restituito un errore: varianti non valide');
  });
});
