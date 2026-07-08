import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildTrafficFilter, getTrafficReport } from '@/lib/ebayAnalytics';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildTrafficFilter', () => {
  it('formatta le date come YYYYMMDD (8 cifre) e i listing come listing_ids:{id1|id2}', () => {
    const start = new Date('2026-06-08T00:00:00.000Z');
    const end = new Date('2026-07-08T00:00:00.000Z');

    const filter = buildTrafficFilter(start, end, ['111', '222', '333']);

    expect(filter).toBe('date_range:[20260608..20260708],listing_ids:{111|222|333}');
  });

  it('gestisce un singolo listing id senza pipe superflue', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2026-01-31T00:00:00.000Z');

    const filter = buildTrafficFilter(start, end, ['999']);

    expect(filter).toBe('date_range:[20260101..20260131],listing_ids:{999}');
  });
});

describe('getTrafficReport', () => {
  it('ritorna una mappa vuota se non ci sono item id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await getTrafficReport('token', []);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chiama l\'endpoint con il filtro corretto e converte CLICK_THROUGH_RATE da frazione a percentuale', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        header: {
          dimensionKeys: [{ key: 'LISTING' }],
          metrics: [
            { key: 'LISTING_IMPRESSION_TOTAL' },
            { key: 'LISTING_VIEWS_TOTAL' },
            { key: 'CLICK_THROUGH_RATE' },
          ],
        },
        records: [
          {
            dimensionValues: [{ applicable: true, value: '123456789012' }],
            metricValues: [
              { applicable: true, value: '1000' },
              { applicable: true, value: '15' },
              { applicable: true, value: '0.015' },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getTrafficReport('token', ['123456789012']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('filter')).toMatch(/^date_range:\[\d{8}\.\.\d{8}\],listing_ids:\{123456789012\}$/);

    const data = result.get('123456789012');
    expect(data).toEqual({
      itemId: '123456789012',
      impressionCount: 1000,
      clickCount: 15,
      clickThroughRate: 1.5, // 0.015 -> 1.5%
    });
  });

  it('logga status e body e ritorna una mappa vuota (non-fatale) se la risposta non è ok', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => '{"errors":[{"message":"Invalid filter"}]}',
      })
    );

    const result = await getTrafficReport('token', ['123456789012']);

    expect(result.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('status=400')
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid filter')
    );
  });
});
