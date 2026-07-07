import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handleListProducts } from '@/lib/commands/listproducts';

describe('handleListProducts', () => {
  it('mostra un messaggio se non ci sono prodotti', async () => {
    const supabase = createFakeSupabase([{ data: [], error: null }]);
    const result = await handleListProducts({ supabase, chatId: 1, args: '' });
    expect(result.text).toContain('Nessun prodotto monitorato');
  });

  it('elenca i prodotti monitorati con bottoni di gestione', async () => {
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A', status: 'active' }, { id: 2, title: 'Prodotto B', status: 'paused' }], error: null },
    ]);
    const result = await handleListProducts({ supabase, chatId: 1, args: '' });
    expect(result.text).toContain('I tuoi prodotti monitorati');
    expect(result.replyMarkup).toEqual({
      inline_keyboard: [
        [{ text: '▶️ Prodotto A', callback_data: 'manage_item:1' }],
        [{ text: '⏸️ Prodotto B', callback_data: 'manage_item:2' }],
      ],
    });
  });
});
