import { describe, it, expect, vi, afterEach } from 'vitest';
import { getMarketInsights, isOwnItem, MIN_COMPARABLE_SAMPLE } from '@/lib/marketAnalysis';

vi.mock('@/lib/ebaySuggestCategory', () => ({
  getBestCategory: vi.fn().mockResolvedValue(null),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OWN_ITEM_ID = '123456789012';

function browseResponse(itemSummaries: any[]) {
  return { ok: true, json: async () => ({ itemSummaries }) };
}

function competitor(price: string, id: string) {
  return { itemId: `v1|${id}|0`, legacyItemId: id, title: `Prodotto Concorrente ${id}`, price: { value: price } };
}

describe('isOwnItem', () => {
  it('riconosce il proprio item tramite legacyItemId', () => {
    expect(isOwnItem({ legacyItemId: OWN_ITEM_ID }, OWN_ITEM_ID)).toBe(true);
  });

  it('riconosce il proprio item tramite itemId nel formato v1|<legacyId>|0', () => {
    expect(isOwnItem({ itemId: `v1|${OWN_ITEM_ID}|0` }, OWN_ITEM_ID)).toBe(true);
  });

  it('non considera proprio un item con id diverso', () => {
    expect(isOwnItem({ itemId: 'v1|999999999999|0', legacyItemId: '999999999999' }, OWN_ITEM_ID)).toBe(false);
  });

  it('ritorna false se ownEbayItemId è vuoto', () => {
    expect(isOwnItem({ itemId: `v1|${OWN_ITEM_ID}|0` }, '')).toBe(false);
  });
});

describe('getMarketInsights', () => {
  it('esclude la propria inserzione dal calcolo della media di mercato', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        browseResponse([
          { itemId: `v1|${OWN_ITEM_ID}|0`, legacyItemId: OWN_ITEM_ID, title: 'Prodotto Test', price: { value: '88.83' } },
          competitor('20.00', '1'),
          competitor('22.00', '2'),
          competitor('24.00', '3'),
        ])
      )
    );

    const insights = await getMarketInsights('token', 'Prodotto Test', '123', OWN_ITEM_ID);

    expect(insights.insufficientData).toBe(false);
    expect(insights.averagePrice).toBe(22); // (20+22+24)/3, own item (88.83) excluded
  });

  it('segnala insufficientData e averagePrice null se restano meno di 3 competitor dopo l\'esclusione', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        browseResponse([
          { itemId: `v1|${OWN_ITEM_ID}|0`, legacyItemId: OWN_ITEM_ID, title: 'Prodotto Test', price: { value: '88.83' } },
          competitor('20.00', '1'),
          competitor('22.00', '2'),
        ])
      )
    );

    const insights = await getMarketInsights('token', 'Prodotto Test', '123', OWN_ITEM_ID);

    expect(insights.averagePrice).toBeNull();
    expect(insights.insufficientData).toBe(true);
  });

  it(`richiede almeno ${MIN_COMPARABLE_SAMPLE} competitor anche senza item propri nei risultati`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(browseResponse([competitor('20.00', '1'), competitor('22.00', '2')]))
    );

    const insights = await getMarketInsights('token', 'Prodotto Test', '123', OWN_ITEM_ID);

    expect(insights.averagePrice).toBeNull();
    expect(insights.insufficientData).toBe(true);
  });

  it('segnala insufficientData se la ricerca non trova risultati', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(browseResponse([])));

    const insights = await getMarketInsights('token', 'Prodotto Test', '123', OWN_ITEM_ID);

    expect(insights.averagePrice).toBeNull();
    expect(insights.insufficientData).toBe(true);
  });

  it('segnala insufficientData se la ricerca eBay fallisce', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const insights = await getMarketInsights('token', 'Prodotto Test', '123', OWN_ITEM_ID);

    expect(insights.averagePrice).toBeNull();
    expect(insights.insufficientData).toBe(true);
  });
});
