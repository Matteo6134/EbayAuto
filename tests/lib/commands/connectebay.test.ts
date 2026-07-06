import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ buildAuthorizeUrl: vi.fn() }));

import { buildAuthorizeUrl } from '@/lib/ebayOAuth';
import { handleConnectEbay } from '@/lib/commands/connectebay';

describe('handleConnectEbay', () => {
  beforeEach(() => {
    vi.mocked(buildAuthorizeUrl).mockReset();
  });

  it('salva lo state e restituisce il link di autorizzazione', async () => {
    vi.mocked(buildAuthorizeUrl).mockReturnValue('https://auth.ebay.com/oauth2/authorize?state=xyz');
    const supabase = createFakeSupabase([{ data: null, error: null }]);

    const result = await handleConnectEbay({ supabase, chatId: 210039451, args: '' });

    expect(result.text).toContain('https://auth.ebay.com/oauth2/authorize?state=xyz');
    expect(buildAuthorizeUrl).toHaveBeenCalledWith(expect.any(String));
  });

  it('segnala un errore se il salvataggio su Supabase fallisce', async () => {
    const supabase = createFakeSupabase([{ data: null, error: { message: 'db down' } }]);
    const result = await handleConnectEbay({ supabase, chatId: 210039451, args: '' });
    expect(result.text).toContain('Errore nel preparare il collegamento eBay: db down');
  });

  it('segnala un errore se la configurazione OAuth manca', async () => {
    vi.mocked(buildAuthorizeUrl).mockImplementation(() => {
      throw new Error('EBAY_CLIENT_ID, EBAY_CLIENT_SECRET o EBAY_RUNAME mancanti');
    });
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleConnectEbay({ supabase, chatId: 210039451, args: '' });
    expect(result.text).toContain('Errore di configurazione');
  });
});
