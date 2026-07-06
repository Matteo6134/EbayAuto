import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ebay')>();
  return { ...actual, fetchListingSummary: vi.fn() };
});

import { fetchListingSummary } from '@/lib/ebay';
import { handleAddProduct } from '@/lib/commands/addproduct';

describe('handleAddProduct', () => {
  beforeEach(() => {
    vi.mocked(fetchListingSummary).mockReset();
  });

  it('chiede un ID valido se gli argomenti non contengono un ID eBay', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: 'boh' });
    expect(result.text).toContain('Uso: /addproduct');
  });

  it('segnala se l\'inserzione non viene trovata su eBay', async () => {
    vi.mocked(fetchListingSummary).mockRejectedValue(new Error('eBay non ha trovato l\'inserzione 123456789012 (status 404)'));
    const supabase = createFakeSupabase([]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: '123456789012' });
    expect(result.text).toContain('Non sono riuscito a trovare l\'inserzione');
  });

  it('segnala se il prodotto è già monitorato', async () => {
    vi.mocked(fetchListingSummary).mockResolvedValue({
      itemId: '123456789012',
      title: 'Prodotto X',
      categoryId: '1',
      categoryName: 'Cat',
      price: 10,
      currency: 'EUR',
    });
    const supabase = createFakeSupabase([{ data: { id: 7 }, error: null }]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: '123456789012' });
    expect(result.text).toContain('è già monitorato');
  });

  it('aggiunge un nuovo prodotto e conferma', async () => {
    vi.mocked(fetchListingSummary).mockResolvedValue({
      itemId: '123456789012',
      title: 'Prodotto X',
      categoryId: '1',
      categoryName: 'Elettronica',
      price: 10,
      currency: 'EUR',
    });
    const supabase = createFakeSupabase([
      { data: null, error: null },
      { data: { id: 3 }, error: null },
    ]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: '123456789012' });
    expect(result.text).toContain('Aggiunto ai prodotti monitorati (id 3)');
    expect(result.text).toContain('Prodotto X');
  });
});
