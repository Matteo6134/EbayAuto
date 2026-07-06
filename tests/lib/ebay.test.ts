import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractItemId } from '@/lib/ebay';

describe('extractItemId', () => {
  it('riconosce un ID numerico diretto', () => {
    expect(extractItemId('123456789012')).toBe('123456789012');
  });

  it('estrae l\'ID da un URL eBay', () => {
    expect(extractItemId('https://www.ebay.it/itm/123456789012')).toBe('123456789012');
  });

  it('estrae l\'ID da un URL eBay con slug', () => {
    expect(extractItemId('https://www.ebay.it/itm/Titolo-prodotto/123456789012')).toBe('123456789012');
  });

  it('ritorna null per un input non valido', () => {
    expect(extractItemId('non un id valido')).toBeNull();
  });
});

describe('getAppAccessToken / fetchListingSummary', () => {
  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = 'client-id';
    process.env.EBAY_CLIENT_SECRET = 'client-secret';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ottiene un token e lo usa per recuperare l\'inserzione', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Prodotto di test',
          categoryId: '12345',
          categoryPath: 'Elettronica|Test',
          price: { value: '19.99', currency: 'EUR' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchListingSummary } = await import('@/lib/ebay');
    const summary = await fetchListingSummary('123456789012');

    expect(summary).toEqual({
      itemId: '123456789012',
      title: 'Prodotto di test',
      categoryId: '12345',
      categoryName: 'Elettronica|Test',
      price: 19.99,
      currency: 'EUR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lancia un errore se eBay non trova l\'inserzione', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchListingSummary } = await import('@/lib/ebay');
    await expect(fetchListingSummary('000000000000')).rejects.toThrow(
      "eBay non ha trovato l'inserzione 000000000000 (status 404)"
    );
  });
});
