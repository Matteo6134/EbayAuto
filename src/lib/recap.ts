export interface ListingRecapData {
  title: string;
  today: { watchCount: number; quantitySold: number; revenue: number };
  avgWatch: number;
  informationalNotes: string[];
}

export function buildDailySummaryText(listings: ListingRecapData[]): string {
  if (listings.length === 0) {
    return 'Nessun prodotto monitorato con dati sufficienti per il recap di oggi.';
  }

  const lines = listings.map((listing) => {
    const trend =
      listing.avgWatch > 0
        ? `${listing.today.watchCount >= listing.avgWatch ? '+' : ''}${Math.round(
            ((listing.today.watchCount - listing.avgWatch) / listing.avgWatch) * 100
          )}%`
        : 'n/d';
    const base = `📊 ${listing.title} — oggi: ${listing.today.watchCount} osservatori (${trend} vs media), ${listing.today.quantitySold} venduti`;
    const notes = listing.informationalNotes.map((note) => `   ⚠️ ${note}`).join('\n');
    return notes ? `${base}\n${notes}` : base;
  });

  return `Recap giornaliero:\n\n${lines.join('\n\n')}`;
}
