import { describe, it, expect } from 'vitest';
import { buildDailySummaryText, type ListingRecapData } from '@/lib/recap';

describe('buildDailySummaryText', () => {
  it('segnala se non ci sono prodotti', () => {
    expect(buildDailySummaryText([])).toBe('Nessun prodotto monitorato con dati sufficienti per il recap di oggi.');
  });

  it('include metriche e trend per ogni prodotto', () => {
    const listings: ListingRecapData[] = [
      { title: 'Prodotto A', today: { watchCount: 12, quantitySold: 1, revenue: 20 }, avgWatch: 10, informationalNotes: [] },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('Prodotto A');
    expect(text).toContain('12 osservatori');
    expect(text).toContain('+20%');
    expect(text).toContain('1 venduti');
  });

  it('include le note informative sotto il prodotto', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Prodotto B',
        today: { watchCount: 1, quantitySold: 0, revenue: 0 },
        avgWatch: 10,
        informationalNotes: ['possibile categoria da rivedere'],
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('⚠️ possibile categoria da rivedere');
  });

  it('usa il formato compatto con impression/click/CTR quando i dati di traffico sono disponibili', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Mercedes W177',
        today: { watchCount: 16, quantitySold: 0, revenue: 0 },
        avgWatch: 10,
        informationalNotes: [],
        traffic: { impressionCount: 183, clickCount: 53, clickThroughRate: 1.0 },
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('👁 183 impression');
    expect(text).toContain('53 click (CTR 1.0%)');
    expect(text).toContain('16 osservatori');
    expect(text).toContain('0 venduti');
  });

  it('aggiunge il trend impression vs ieri quando disponibile lo storico di ieri', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Mercedes W177',
        today: { watchCount: 16, quantitySold: 0, revenue: 0 },
        avgWatch: 10,
        informationalNotes: [],
        traffic: { impressionCount: 224, clickCount: 53, clickThroughRate: 1.0, previousImpressionCount: 200 },
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('(impression +12% vs ieri)');
  });

  it('mostra un trend negativo quando le impression calano rispetto a ieri', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Mercedes W177',
        today: { watchCount: 16, quantitySold: 0, revenue: 0 },
        avgWatch: 10,
        informationalNotes: [],
        traffic: { impressionCount: 90, clickCount: 5, clickThroughRate: 5.5, previousImpressionCount: 100 },
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('(impression -10% vs ieri)');
  });

  it('non aggiunge il trend se non è disponibile lo storico di ieri', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Mercedes W177',
        today: { watchCount: 16, quantitySold: 0, revenue: 0 },
        avgWatch: 10,
        informationalNotes: [],
        traffic: { impressionCount: 183, clickCount: 53, clickThroughRate: 1.0 },
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).not.toContain('vs ieri');
  });

  it('ricade sulla riga solo-osservatori quando traffic è null (analytics non disponibile)', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Prodotto C',
        today: { watchCount: 12, quantitySold: 1, revenue: 20 },
        avgWatch: 10,
        informationalNotes: [],
        traffic: null,
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('12 osservatori (+20% vs media)');
    expect(text).not.toContain('👁');
  });
});
