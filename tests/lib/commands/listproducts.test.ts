import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handleListProducts } from '@/lib/commands/listproducts';

describe('handleListProducts', () => {
  it('mostra un messaggio se non ci sono prodotti', async () => {
    const supabase = createFakeSupabase([{ data: [], error: null }]);
    const result = await handleListProducts({ supabase, chatId: 1, args: '' });
    expect(result.text).toContain('Nessun prodotto monitorato');
  });

  it('elenca i prodotti monitorati con id e stato', async () => {
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A', status: 'active' }, { id: 2, title: 'Prodotto B', status: 'paused' }], error: null },
    ]);
    const result = await handleListProducts({ supabase, chatId: 1, args: '' });
    expect(result.text).toBe('#1 [active] Prodotto A\n#2 [paused] Prodotto B');
  });
});
