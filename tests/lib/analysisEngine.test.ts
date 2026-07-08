import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/marketAnalysis', () => ({
  getMarketInsights: vi.fn(),
}));
vi.mock('@/lib/ebayLazarus', () => ({
  checkListingIndexed: vi.fn(),
}));
vi.mock('@/lib/ebaySeoDoctor', () => ({
  analyzeSeoSpecifics: vi.fn(),
}));

import { analyzeListing, type ListingSnapshot, type MetricPoint } from '@/lib/analysisEngine';
import { getMarketInsights } from '@/lib/marketAnalysis';
import { checkListingIndexed } from '@/lib/ebayLazarus';
import { analyzeSeoSpecifics } from '@/lib/ebaySeoDoctor';

const FAKE_TOKEN = 'fake-token';

const emptyInsights = {
  averagePrice: null,
  suggestedCategoryId: null,
  suggestedCategoryName: null,
  suggestedTitle: null,
  insufficientData: true,
};

function metric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metricDate: '2026-07-01',
    watchCount: 10,
    quantitySold: 0,
    revenue: 0,
    price: 20,
    adRatePercent: null,
    impressionCount: null,
    clickCount: null,
    clickThroughRate: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    listingId: 1,
    ebayItemId: '123456789012',
    title: 'Prodotto Test',
    categoryId: '123',
    today: metric(),
    history: [],
    ...overrides,
  };
}

describe('analyzeListing', () => {
  beforeEach(() => {
    vi.mocked(getMarketInsights).mockReset().mockResolvedValue(emptyInsights);
    vi.mocked(checkListingIndexed).mockReset().mockResolvedValue({ isIndexed: true, searchResultCount: 5 });
    vi.mocked(analyzeSeoSpecifics).mockReset().mockResolvedValue(null);
  });

  it('non genera proposte se non c\'è abbastanza storico e i numeri sono normali', async () => {
    const result = await analyzeListing(snapshot(), FAKE_TOKEN);
    expect(result).toEqual([]);
  });

  it('propone il cambio categoria se non c\'è interesse né vendite da giorni', async () => {
    // Only 2 history rows: below the hasEnoughHistory (>=3) threshold, so the
    // Ghost Check / Lazarus / Social Booster / offer paths stay inactive and only
    // the "no interest at all" + "visibility dropped" branches can fire.
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const result = await analyzeListing(
      snapshot({ today: metric({ watchCount: 0, quantitySold: 0 }), history }),
      FAKE_TOKEN
    );

    expect(result).toEqual([
      {
        field: 'category',
        currentValue: '123',
        proposedValue: 'rivedi manualmente',
        rationale: 'Nessun interesse (0 osservatori oggi) e nessuna vendita. Anche il motore eBay non ha una categoria chiara per questo prodotto: prova a modificare il titolo con parole più precise.',
        impact: 'high',
        actionable: false,
      },
      {
        field: 'title',
        currentValue: 'Prodotto Test',
        proposedValue: 'aggiungi keyword popolari o dettagli tecnici',
        rationale: 'Attenzione scarsa o in calo (oggi 0 osservatori). Rivedi il titolo per migliorare la SEO su eBay.',
        impact: 'normal',
        actionable: false,
      },
    ]);
  });

  it('propone di rivedere il titolo se le visite calano e non c\'è ancora una % ads nota', async () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const result = await analyzeListing(snapshot({ today: metric({ watchCount: 2 }), history }), FAKE_TOKEN);

    expect(result).toEqual([
      {
        field: 'title',
        currentValue: 'Prodotto Test',
        proposedValue: 'aggiungi keyword popolari o dettagli tecnici',
        rationale: 'Attenzione scarsa o in calo (oggi 2 osservatori). Rivedi il titolo per migliorare la SEO su eBay.',
        impact: 'normal',
        actionable: false,
      },
    ]);
  });

  it('propone di alzare la % ads se le visite calano e la % ads è nota', async () => {
    const history = [metric({ watchCount: 10, adRatePercent: 5 }), metric({ watchCount: 10, adRatePercent: 5 })];
    const result = await analyzeListing(
      snapshot({ today: metric({ watchCount: 2, adRatePercent: 5 }), history }),
      FAKE_TOKEN
    );

    expect(result).toEqual([
      {
        field: 'ad_rate',
        currentValue: '5%',
        proposedValue: '7%',
        rationale: 'Scarso interesse: oggi 2 osservatori. Un piccolo boost alle ads può aiutare l\'algoritmo di eBay.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });

  it('propone offerta agli osservatori e social boost se c\'è interesse ma nessuna vendita da giorni (l\'offerta ha priorità sullo sconto prezzo)', async () => {
    // hasEnoughHistory (>=3 rows) + recentSales===0 also activates the Social
    // Booster block, and watchCount>=3 with recentSales===0 activates the
    // Negotiation-API watcher offer, which takes priority over (and suppresses)
    // the plain 10% price-discount proposal further down.
    const history = [
      metric({ watchCount: 8, quantitySold: 0 }),
      metric({ watchCount: 8, quantitySold: 0 }),
      metric({ watchCount: 8, quantitySold: 0 }),
    ];
    const result = await analyzeListing(
      snapshot({ today: metric({ watchCount: 8, quantitySold: 0, price: 20 }), history }),
      FAKE_TOKEN
    );

    expect(result).toEqual([
      {
        field: 'social_boost',
        currentValue: 'Traffico solo da eBay',
        proposedValue: 'Genera Post Social (Facebook/IG)',
        rationale: 'Le visualizzazioni organiche sono ferme. Condividi questo annuncio sui Social per portare traffico esterno (eBay Cassini premia molto chi porta traffico da fuori!).',
        impact: 'normal',
        actionable: true,
      },
      {
        field: 'offer',
        currentValue: '8 osservatori, 0 vendite',
        proposedValue: JSON.stringify({ discount: 5, ebayItemId: '123456789012', currentPrice: 20 }),
        rationale: "🎯 Hai 8 persone che osservano senza comprare da 3+ giorni. Invia loro un'offerta privata sconto 5% valida 48h — chiudi la vendita adesso!",
        impact: 'high',
        actionable: true,
      },
    ]);
  });

  it('propone di abbassare la % ads se è stata aumentata senza risultati', async () => {
    const history = [metric({ watchCount: 10, adRatePercent: 5 })];
    const result = await analyzeListing(
      snapshot({ today: metric({ watchCount: 10, adRatePercent: 8 }), history }),
      FAKE_TOKEN
    );

    expect(result).toEqual([
      {
        field: 'ad_rate',
        currentValue: '8%',
        proposedValue: '6%',
        rationale: 'La % ads è stata aumentata di recente ma gli osservatori non sono aumentati in proporzione: valuta di ridurla.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });

  it('esegue il Ghost Check e propone il relist se la ricerca su eBay non trova la mia inserzione (richiede almeno 7 giorni di storico)', async () => {
    const history = Array.from({ length: 7 }, () => metric({ watchCount: 0, quantitySold: 0 }));
    vi.mocked(checkListingIndexed).mockResolvedValue({ isIndexed: false, searchResultCount: 0 });

    const result = await analyzeListing(
      snapshot({ today: metric({ watchCount: 0, quantitySold: 0, impressionCount: 0 }), history }),
      FAKE_TOKEN
    );

    expect(checkListingIndexed).toHaveBeenCalledWith(FAKE_TOKEN, 'Prodotto Test');
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe('relist');
    expect(result[0].rationale).toContain('SHADOW BAN');
  });

  it('non chiama il Ghost Check se la vendita non è completamente morta', async () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    await analyzeListing(snapshot({ today: metric({ watchCount: 5 }), history }), FAKE_TOKEN);

    expect(checkListingIndexed).not.toHaveBeenCalled();
  });

  it('non arma il Ghost Check / Lazarus con meno di 7 giorni di storico anche se tutto è a zero', async () => {
    // Only 6 days: below the 7-day minimum required for the irreversible
    // Ghost Check / Lazarus relist path, even though the listing looks
    // "completely dead" (0 watchers, 0 sales, 0 impressions).
    const history = Array.from({ length: 6 }, () => metric({ watchCount: 0, quantitySold: 0 }));

    await analyzeListing(
      snapshot({ today: metric({ watchCount: 0, quantitySold: 0, impressionCount: 0 }), history }),
      FAKE_TOKEN
    );

    expect(checkListingIndexed).not.toHaveBeenCalled();
  });

  it('passa il proprio ebayItemId a getMarketInsights per escludere la propria inserzione dal confronto', async () => {
    await analyzeListing(snapshot({ ebayItemId: '999888777666' }), FAKE_TOKEN);

    expect(getMarketInsights).toHaveBeenCalledWith(FAKE_TOKEN, 'Prodotto Test', '123', '999888777666');
  });

  it('non emette alcuna nota prezzo-vs-mercato quando i dati di mercato sono insufficienti', async () => {
    vi.mocked(getMarketInsights).mockResolvedValue({
      averagePrice: null,
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      suggestedTitle: null,
      insufficientData: true,
    });

    const result = await analyzeListing(snapshot(), FAKE_TOKEN);

    expect(result.some((p) => p.field === 'price')).toBe(false);
  });
});
