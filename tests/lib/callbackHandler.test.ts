import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({ applyProposal: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { applyProposal } from '@/lib/ebayRevise';
import { handleProposalCallback } from '@/lib/callbackHandler';

function fakeSupabase(queue: Array<{ data: any; error: any }>) {
  let i = 0;
  const next = () => queue[Math.min(i++, queue.length - 1)];
  const builder: any = {
    from: () => builder,
    select: () => builder,
    update: () => builder,
    insert: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(next()),
    then: (resolve: any) => resolve(next()),
  };
  return builder;
}

describe('handleProposalCallback', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(applyProposal).mockReset();
  });

  it('ritorna null se il formato di callback_data non è riconosciuto', async () => {
    const supabase = fakeSupabase([]);
    const result = await handleProposalCallback(supabase, 'qualcosa:non:valido');
    expect(result).toBeNull();
  });

  it('segnala se la proposta non esiste', async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    const result = await handleProposalCallback(supabase, 'proposal:1:approve');
    expect(result?.text).toContain('Proposta non trovata');
  });

  it('segnala se la proposta è già stata gestita', async () => {
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'applied' }, error: null },
    ]);
    const result = await handleProposalCallback(supabase, 'proposal:1:approve');
    expect(result?.text).toContain('già stata gestita');
  });

  it('rifiuta una proposta pending e aggiorna lo stato', async () => {
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
    ]);
    const result = await handleProposalCallback(supabase, 'proposal:1:reject');
    expect(result).toEqual({ chatId: 210039451, text: '❌ Proposta rifiutata: Prodotto A' });
  });

  it('applica una proposta approvata e aggiorna proposals + change_log', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockResolvedValue(undefined);
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleProposalCallback(supabase, 'proposal:1:approve');

    expect(applyProposal).toHaveBeenCalledWith('access-1', 'AAA', 'price', '18.00');
    expect(result).toEqual({
      chatId: 210039451,
      text: '✅ Applicato: Prodotto A — price aggiornato a 18.00',
    });
  });

  it('segnala se la modifica è stata applicata su eBay ma la registrazione interna fallisce', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockResolvedValue(undefined);
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: null, error: { message: 'update fallito' } },
      { data: null, error: null },
    ]);

    const result = await handleProposalCallback(supabase, 'proposal:1:approve');

    expect(applyProposal).toHaveBeenCalledWith('access-1', 'AAA', 'price', '18.00');
    expect(result?.chatId).toBe(210039451);
    expect(result?.text).toContain('Modifica applicata su eBay');
    expect(result?.text).toContain('Non approvare di nuovo');
  });

  it('segnala un fallimento se applyProposal lancia un errore', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockRejectedValue(new Error('eBay ha rifiutato la modifica'));
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleProposalCallback(supabase, 'proposal:1:approve');

    expect(result?.text).toContain('eBay ha rifiutato la modifica');
  });
});
