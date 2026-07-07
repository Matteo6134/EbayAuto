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
});
