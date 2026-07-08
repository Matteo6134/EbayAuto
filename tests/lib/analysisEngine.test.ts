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
  competitorCount: 0,
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
      competitorCount: 0,
    });

    const result = await analyzeListing(snapshot(), FAKE_TOKEN);

    expect(result.some((p) => p.field === 'price')).toBe(false);
  });

  describe('CTR-based rules (B1)', () => {
    it('alta visibilità, basso interesse: CTR basso con impression sufficienti genera una proposta titolo actionable con i numeri reali in italiano', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: null,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: 'Titolo Ottimizzato Dai Concorrenti',
        insufficientData: true,
        competitorCount: 0,
      });

      const result = await analyzeListing(
        snapshot({
          today: metric({ watchCount: 10, impressionCount: 183, clickCount: 2, clickThroughRate: 1.0 }),
          history: [metric({ watchCount: 10 }), metric({ watchCount: 10 })],
        }),
        FAKE_TOKEN
      );

      const titleProposal = result.find((p) => p.field === 'title');
      expect(titleProposal).toBeDefined();
      expect(titleProposal?.actionable).toBe(true);
      expect(titleProposal?.proposedValue).toBe('Titolo Ottimizzato Dai Concorrenti');
      expect(titleProposal?.rationale).toContain('183 impression');
      expect(titleProposal?.rationale).toContain('1.0%');
      // Solo una proposta titolo per prodotto per esecuzione
      expect(result.filter((p) => p.field === 'title')).toHaveLength(1);
    });

    it('CTR basso senza titolo suggerito dal mercato resta informativo ma cita comunque i numeri reali', async () => {
      const result = await analyzeListing(
        snapshot({
          today: metric({ watchCount: 10, impressionCount: 200, clickCount: 2, clickThroughRate: 1.0 }),
          history: [metric({ watchCount: 10 }), metric({ watchCount: 10 })],
        }),
        FAKE_TOKEN
      );

      const titleProposal = result.find((p) => p.field === 'title');
      expect(titleProposal).toBeDefined();
      expect(titleProposal?.actionable).toBe(false);
      expect(titleProposal?.rationale).toContain('200 impression');
      expect(titleProposal?.rationale).toContain('1.0%');
    });

    it('non genera la regola CTR se le impression sono sotto soglia (50)', async () => {
      const result = await analyzeListing(
        snapshot({
          today: metric({ watchCount: 10, impressionCount: 40, clickCount: 1, clickThroughRate: 1.0 }),
        }),
        FAKE_TOKEN
      );

      expect(result.some((p) => p.field === 'title')).toBe(false);
    });

    it('non genera alcuna regola CTR quando i dati Analytics sono null (no-op)', async () => {
      const result = await analyzeListing(
        snapshot({
          today: metric({ watchCount: 10, impressionCount: null, clickCount: null, clickThroughRate: null }),
        }),
        FAKE_TOKEN
      );

      expect(result.some((p) => p.field === 'title')).toBe(false);
      expect(result.some((p) => p.field === 'price')).toBe(false);
    });

    it('buon interesse, nessuna vendita: CTR alto con impression sufficienti e mercato disponibile genera una proposta prezzo ancorata al mercato', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: 100,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: false,
        competitorCount: 8,
      });

      const result = await analyzeListing(
        snapshot({
          today: metric({
            watchCount: 1,
            quantitySold: 0,
            price: 120,
            impressionCount: 183,
            clickCount: 53,
            clickThroughRate: 2.9,
          }),
          history: [metric({ watchCount: 1, quantitySold: 0 })],
        }),
        FAKE_TOKEN
      );

      const priceProposal = result.find((p) => p.field === 'price');
      expect(priceProposal).toBeDefined();
      expect(priceProposal?.actionable).toBe(true);
      expect(priceProposal?.proposedValue).toBe('105.00');
      expect(priceProposal?.rationale).toContain('clicca');
      expect(priceProposal?.rationale.toLowerCase()).toContain('vendit');
    });

    it('CTR alto ma nessuna vendita non genera proposta prezzo se il prezzo non è sopra la soglia di mercato', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: 100,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: false,
        competitorCount: 8,
      });

      const result = await analyzeListing(
        snapshot({
          today: metric({
            watchCount: 1,
            quantitySold: 0,
            price: 100,
            impressionCount: 183,
            clickCount: 53,
            clickThroughRate: 2.9,
          }),
          history: [metric({ watchCount: 1, quantitySold: 0 })],
        }),
        FAKE_TOKEN
      );

      const priceProposal = result.find((p) => p.field === 'price');
      expect(priceProposal?.actionable).toBe(false); // ramo "in linea col mercato"
    });
  });

  describe('Prezzo ancorato al mercato (B3)', () => {
    it('prezzo sopra mercato + interesse senza vendite (osservatori): propone di scendere a media*1.05', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: 100,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: false,
        competitorCount: 5,
      });

      const history = [
        metric({ watchCount: 8, quantitySold: 0 }),
        metric({ watchCount: 8, quantitySold: 0 }),
        metric({ watchCount: 8, quantitySold: 0 }),
      ];
      const result = await analyzeListing(
        snapshot({ today: metric({ watchCount: 8, quantitySold: 0, price: 130 }), history }),
        FAKE_TOKEN
      );

      const priceProposal = result.find((p) => p.field === 'price');
      expect(priceProposal).toBeDefined();
      expect(priceProposal?.actionable).toBe(true);
      expect(priceProposal?.proposedValue).toBe('105.00');
      expect(priceProposal?.rationale).toContain('100.00');
      expect(priceProposal?.rationale).toContain('5 concorrenti');
    });

    it('prezzo sotto mercato: propone di salire a media*0.95 con motivazione "margine sul tavolo"', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: 100,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: false,
        competitorCount: 5,
      });

      const result = await analyzeListing(snapshot({ today: metric({ price: 80 }) }), FAKE_TOKEN);

      const priceProposal = result.find((p) => p.field === 'price');
      expect(priceProposal).toBeDefined();
      expect(priceProposal?.actionable).toBe(true);
      expect(priceProposal?.proposedValue).toBe('95.00');
      expect(priceProposal?.rationale).toContain('margine sul tavolo');
    });

    it('dati di mercato insufficienti: la regola di mercato non emette nulla e il vecchio ramo prezzo/offerta gestisce il caso (l\'offerta ha priorità, comportamento preesistente)', async () => {
      // NOTE: con hasEnoughHistory + watchCount>=3 + recentSales===0, la regola
      // "Watcher Offer" (Negotiation API) ha sempre priorità sul fallback
      // sconto 10% — è un comportamento preesistente e intenzionale (vedi test
      // "l'offerta ha priorità sullo sconto prezzo" sopra), non introdotto da
      // questa modifica. Qui verifichiamo solo che, quando il mercato è
      // insufficiente, NON venga comunque emessa la proposta prezzo
      // ancora-al-mercato (che richiede averagePrice non nullo).
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: null,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: true,
        competitorCount: 0,
      });

      const history = [
        metric({ watchCount: 8, quantitySold: 0 }),
        metric({ watchCount: 8, quantitySold: 0 }),
        metric({ watchCount: 8, quantitySold: 0 }),
      ];
      const result = await analyzeListing(
        snapshot({ today: metric({ watchCount: 8, quantitySold: 0, price: 20 }), history }),
        FAKE_TOKEN
      );

      expect(result.some((p) => p.field === 'offer')).toBe(true);
      const priceProposal = result.find((p) => p.field === 'price');
      // Nessuna proposta prezzo ancorata al mercato (i dati sono insufficienti);
      // l'unico prezzo possibile qui sarebbe il fallback -10%, che l'offerta
      // preesistente sopprime by design.
      expect(priceProposal).toBeUndefined();
    });


    it('applica il clamp di sicurezza: non propone mai una variazione di prezzo superiore al 30% in un colpo solo (sopra mercato)', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: 100,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: false,
        competitorCount: 5,
      });

      const history = [
        metric({ watchCount: 8, quantitySold: 0 }),
        metric({ watchCount: 8, quantitySold: 0 }),
        metric({ watchCount: 8, quantitySold: 0 }),
      ];
      // Prezzo attuale molto alto (500): media*1.05 = 105, ma il clamp lo limita a 500*0.7=350
      const result = await analyzeListing(
        snapshot({ today: metric({ watchCount: 8, quantitySold: 0, price: 500 }), history }),
        FAKE_TOKEN
      );

      const priceProposal = result.find((p) => p.field === 'price');
      expect(priceProposal).toBeDefined();
      expect(priceProposal?.proposedValue).toBe('350.00');
    });

    it('applica il clamp di sicurezza anche sotto mercato (non propone mai +30% in un colpo)', async () => {
      vi.mocked(getMarketInsights).mockResolvedValue({
        averagePrice: 1000,
        suggestedCategoryId: null,
        suggestedCategoryName: null,
        suggestedTitle: null,
        insufficientData: false,
        competitorCount: 5,
      });

      // Prezzo attuale molto basso (10): media*0.95 = 950, ma il clamp lo limita a 10*1.3=13
      const result = await analyzeListing(snapshot({ today: metric({ price: 10 }) }), FAKE_TOKEN);

      const priceProposal = result.find((p) => p.field === 'price');
      expect(priceProposal).toBeDefined();
      expect(priceProposal?.proposedValue).toBe('13.00');
    });
  });
});
