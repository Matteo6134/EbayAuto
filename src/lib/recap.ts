export interface ListingRecapTraffic {
  impressionCount: number;
  clickCount: number;
  clickThroughRate: number; // percentage 0-100
  /** Yesterday's impressions, when available, used to compute a day-over-day trend. */
  previousImpressionCount?: number | null;
}

export interface ListingRecapData {
  title: string;
  today: { watchCount: number; quantitySold: number; revenue: number };
  avgWatch: number;
  informationalNotes: string[];
  /** Real traffic data from the eBay Analytics API. Omitted/null when analytics is unavailable for this listing. */
  traffic?: ListingRecapTraffic | null;
}

function formatTrafficLine(listing: ListingRecapData): string {
  const traffic = listing.traffic;

  if (!traffic) {
    const trend =
      listing.avgWatch > 0
        ? `${listing.today.watchCount >= listing.avgWatch ? '+' : ''}${Math.round(
            ((listing.today.watchCount - listing.avgWatch) / listing.avgWatch) * 100
          )}%`
        : 'n/d';
    return `📊 ${listing.title} — oggi: ${listing.today.watchCount} osservatori (${trend} vs media), ${listing.today.quantitySold} venduti`;
  }

  let trendSuffix = '';
  if (traffic.previousImpressionCount != null && traffic.previousImpressionCount > 0) {
    const pct = Math.round(
      ((traffic.impressionCount - traffic.previousImpressionCount) / traffic.previousImpressionCount) * 100
    );
    const sign = pct >= 0 ? '+' : '';
    trendSuffix = ` (impression ${sign}${pct}% vs ieri)`;
  }

  return `📊 ${listing.title} — 👁 ${traffic.impressionCount.toLocaleString('it-IT')} impression · ${traffic.clickCount.toLocaleString(
    'it-IT'
  )} click (CTR ${traffic.clickThroughRate.toFixed(1)}%) · ${listing.today.watchCount} osservatori · ${listing.today.quantitySold} venduti${trendSuffix}`;
}

export function buildDailySummaryText(listings: ListingRecapData[]): string {
  if (listings.length === 0) {
    return 'Nessun prodotto monitorato con dati sufficienti per il recap di oggi.';
  }

  const lines = listings.map((listing) => {
    const base = formatTrafficLine(listing);
    const notes = listing.informationalNotes.map((note) => `   ⚠️ ${note}`).join('\n');
    return notes ? `${base}\n${notes}` : base;
  });

  return `Recap giornaliero:\n\n${lines.join('\n\n')}`;
}
