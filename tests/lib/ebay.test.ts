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
    vi.useRealTimers();
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

  it('non richiede un nuovo token se quello in cache non è scaduto (chiamate consecutive)', async () => {
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Prodotto due',
          categoryId: '99',
          categoryPath: 'Casa',
          price: { value: '5.00', currency: 'EUR' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchListingSummary } = await import('@/lib/ebay');
    await fetchListingSummary('123456789012');
    await fetchListingSummary('999999999999');

    // 1 chiamata per il token + 2 per le inserzioni = 3, non 4: conferma che il token è stato riutilizzato dalla cache
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('richiede un nuovo token se quello in cache è scaduto', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token-1', expires_in: 120 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ title: 'A', categoryId: '1', categoryPath: 'X', price: { value: '1', currency: 'EUR' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token-2', expires_in: 120 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ title: 'B', categoryId: '2', categoryPath: 'Y', price: { value: '2', currency: 'EUR' } }) });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchListingSummary } = await import('@/lib/ebay');
    await fetchListingSummary('111111111111');
    vi.advanceTimersByTime(61 * 1000);
    await fetchListingSummary('222222222222');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});
