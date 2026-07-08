import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({ reviseItemSpecifics: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { reviseItemSpecifics } from '@/lib/ebayRevise';
import { handleSetSpecifics } from '@/lib/commands/setspecifics';

describe('handleSetSpecifics', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(reviseItemSpecifics).mockReset();
  });

  it('mostra il messaggio di uso se mancano le coppie', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetSpecifics({ supabase, chatId: 1, args: '5' });
    expect(result.text).toBe('Uso: /setspecifics <id> Nome=Valore; Nome=Valore');
    expect(reviseItemSpecifics).not.toHaveBeenCalled();
  });

  it('mostra il messaggio di uso se non ci sono coppie valide', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleSetSpecifics({ supabase, chatId: 1, args: '5 ;;;' });
    expect(result.text).toBe('Uso: /setspecifics <id> Nome=Valore; Nome=Valore');
  });

  it('analizza correttamente coppie multiple separate da punto e virgola, con virgole nei valori', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseItemSpecifics).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: null, error: null },
    ]);

    const result = await handleSetSpecifics({
      supabase,
      chatId: 1,
      args: '1 Marca=Bosch, Makita; Colore=Rosso, Blu ; Tipo=Trapano',
    });

    expect(reviseItemSpecifics).toHaveBeenCalledWith('access-1', 'ITEM1', {
      Marca: 'Bosch, Makita',
      Colore: 'Rosso, Blu',
      Tipo: 'Trapano',
    });
    expect(result.text).toContain('Marca=Bosch, Makita');
    expect(result.text).toContain('Colore=Rosso, Blu');
    expect(result.text).toContain('Tipo=Trapano');
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleSetSpecifics({ supabase, chatId: 1, args: '99 Marca=Bosch' });
    expect(result.text).toBe('Nessun prodotto trovato con id 99.');
  });

  it('segnala se non c\'è un account eBay collegato', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: null, error: null },
    ]);
    const result = await handleSetSpecifics({ supabase, chatId: 1, args: '1 Marca=Bosch' });
    expect(result.text).toBe('Nessun account eBay collegato. Usa /connectebay.');
  });

  it('aggiorna le specifiche con successo', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseItemSpecifics).mockResolvedValue(undefined);
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetSpecifics({ supabase, chatId: 1, args: '1 Marca=Bosch' });

    expect(reviseItemSpecifics).toHaveBeenCalledWith('access-1', 'ITEM1', { Marca: 'Bosch' });
    expect(result.text).toBe('✅ Specifiche aggiornate: Marca=Bosch');
  });

  it('restituisce l\'errore eBay se reviseItemSpecifics fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(reviseItemSpecifics).mockRejectedValue(new Error('ReviseItem ha restituito un errore: specifiche non valide'));
    const supabase = createFakeSupabase([
      { data: { id: 1, ebay_item_id: 'ITEM1' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleSetSpecifics({ supabase, chatId: 1, args: '1 Marca=Bosch' });

    expect(result.text).toBe('ReviseItem ha restituito un errore: specifiche non valide');
  });
});
