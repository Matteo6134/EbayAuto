import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({ applyProposal: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { applyProposal } from '@/lib/ebayRevise';
import { handleSetTitle } from '@/lib/commands/settitle';

describe('handleSetTitle', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(applyProposal).mockReset();
  });

  it('mostra il messaggio di uso se manca il titolo', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetTitle({ supabase, chatId: 1, args: '5' });
    expect(result.text).toBe('Uso: /settitle <id> <nuovo titolo>');
    expect(applyProposal).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se l\'id non è valido', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetTitle({ supabase, chatId: 1, args: 'abc Nuovo titolo' });
    expect(result.text).toBe('Uso: /settitle <id> <nuovo titolo>');
  });

  it('rifiuta titoli oltre 80 caratteri', async () => {
    const supabase = createFakeSupabase([]);
    const longTitle = 'a'.repeat(81);
    const result = await handleSetTitle({ supabase, chatId: 1, args: `5 ${longTitle}` });
    expect(result.text).toBe('Il titolo supera gli 80 caratteri (attuale: 81).');
    expect(applyProposal).not.toHaveBeenCalled();
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleSetTitle({ supabase, chatId: 1, args: '99 Nuovo titolo' });
    expect(result.text).toBe('Nessun prodotto trovato con id 99.');
  });

  it('segnala se non c\'è un account eBay collegato', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: null, error: null },
    ]);
    const result = await handleSetTitle({ supabase, chatId: 1, args: '1 Nuovo titolo' });
    expect(result.text).toBe('Nessun account eBay collegato. Usa /connectebay.');
  });

  it('aggiorna il titolo con successo', async () => {
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

    const result = await handleSetTitle({ supabase, chatId: 1, args: '1 Nuovo titolo fantastico' });

    expect(applyProposal).toHaveBeenCalledWith('access-1', 'ITEM1', 'title', 'Nuovo titolo fantastico');
    expect(result.text).toBe('✅ Titolo aggiornato: Nuovo titolo fantastico');
  });

  it('restituisce l\'errore eBay se applyProposal fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockRejectedValue(new Error('ReviseItem ha restituito un errore: titolo non valido'));
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetTitle({ supabase, chatId: 1, args: '1 Nuovo titolo' });

    expect(result.text).toBe('ReviseItem ha restituito un errore: titolo non valido');
  });
});
