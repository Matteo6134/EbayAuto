import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({ applyProposal: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { applyProposal } from '@/lib/ebayRevise';
import { handleSetCategory } from '@/lib/commands/setcategory';

describe('handleSetCategory', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(applyProposal).mockReset();
  });

  it('mostra il messaggio di uso se manca il categoryId', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetCategory({ supabase, chatId: 1, args: '5' });
    expect(result.text).toBe('Uso: /setcategory <id> <categoryId eBay>');
    expect(applyProposal).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se il categoryId non è numerico', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetCategory({ supabase, chatId: 1, args: '5 abc' });
    expect(result.text).toBe('Uso: /setcategory <id> <categoryId eBay>');
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleSetCategory({ supabase, chatId: 1, args: '99 12345' });
    expect(result.text).toBe('Nessun prodotto trovato con id 99.');
  });

  it('segnala se non c\'è un account eBay collegato', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: null, error: null },
    ]);
    const result = await handleSetCategory({ supabase, chatId: 1, args: '1 12345' });
    expect(result.text).toBe('Nessun account eBay collegato. Usa /connectebay.');
  });

  it('aggiorna la categoria con successo e avvisa dell\'impatto', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: null, error: null },
    ]);

    const result = await handleSetCategory({ supabase, chatId: 1, args: '1 12345' });

    expect(applyProposal).toHaveBeenCalledWith('access-1', 'ITEM1', 'category', '12345');
    expect(result.text).toBe(
      '✅ Categoria aggiornata a 12345. ⚠️ Nota: il cambio categoria può influire sulla visibilità nelle ricerche nei prossimi giorni.'
    );
  });

  it('restituisce l\'errore eBay se applyProposal fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockRejectedValue(new Error('ReviseItem ha restituito un errore: categoria non valida'));
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetCategory({ supabase, chatId: 1, args: '1 12345' });

    expect(result.text).toBe('ReviseItem ha restituito un errore: categoria non valida');
  });
});
