import { describe, it, expect } from 'vitest';
import { analyzeListing, type ListingSnapshot, type MetricPoint } from '@/lib/analysisEngine';

function metric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metricDate: '2026-07-01',
    watchCount: 10,
    quantitySold: 0,
    revenue: 0,
    price: 20,
    adRatePercent: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    listingId: 1,
    title: 'Prodotto Test',
    categoryId: '123',
    today: metric(),
    history: [],
    ...overrides,
  };
}

describe('analyzeListing', () => {
  it('non genera proposte se non c\'è abbastanza storico e i numeri sono normali', () => {
    const result = analyzeListing(snapshot());
    expect(result).toEqual([]);
  });

  it('propone il cambio categoria se non c\'è interesse né vendite da giorni', () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 1, quantitySold: 0 }), history }));

    expect(result).toEqual([
      {
        field: 'category',
        currentValue: '123',
        proposedValue: 'rivedi manualmente la categoria e le keyword del titolo',
        rationale: 'Nessun interesse (oggi 1 watcher, media recente 10.0) e nessuna vendita da almeno 3 giorni.',
        impact: 'high',
        actionable: false,
      },
    ]);
  });

  it('propone di rivedere il titolo se le visite calano e non c\'è ancora una % ads nota', () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 2 }), history }));

    expect(result).toEqual([
      {
        field: 'title',
        currentValue: 'Prodotto Test',
        proposedValue: 'rivedi il titolo con keyword più cercate',
        rationale: 'Visite in calo: oggi 2 watcher contro una media di 10.0.',
        impact: 'normal',
        actionable: false,
      },
    ]);
  });

  it('propone di alzare la % ads se le visite calano e la % ads è nota', () => {
    const history = [metric({ watchCount: 10, adRatePercent: 5 }), metric({ watchCount: 10, adRatePercent: 5 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 2, adRatePercent: 5 }), history }));

    expect(result).toEqual([
      {
        field: 'ad_rate',
        currentValue: '5%',
        proposedValue: '7%',
        rationale: 'Visite in calo: oggi 2 watcher contro una media di 10.0.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });

  it('propone uno sconto del 10% se c\'è interesse ma nessuna vendita', () => {
    const history = [metric({ watchCount: 8, quantitySold: 0 }), metric({ watchCount: 8, quantitySold: 0 }), metric({ watchCount: 8, quantitySold: 0 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 8, quantitySold: 0, price: 20 }), history }));

    expect(result).toEqual([
      {
        field: 'price',
        currentValue: '20.00',
        proposedValue: '18.00',
        rationale: 'Interesse presente (8 watcher) ma nessuna vendita da almeno 3 giorni: sconto del 10% proposto.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });

  it('propone di abbassare la % ads se è stata aumentata senza risultati', () => {
    const history = [metric({ watchCount: 10, adRatePercent: 5 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 10, adRatePercent: 8 }), history }));

    expect(result).toEqual([
      {
        field: 'ad_rate',
        currentValue: '8%',
        proposedValue: '6%',
        rationale: 'La % ads è stata aumentata di recente ma le visite non sono aumentate in proporzione: valuta di ridurla.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });
});
