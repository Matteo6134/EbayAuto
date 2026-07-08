export interface ListingTrafficData {
  itemId: string;
  impressionCount: number;
  clickCount: number;
  clickThroughRate: number; // percentage 0-100
}

/**
 * Formats a Date as the 8-digit YYYYMMDD string required by the eBay
 * Analytics API's `date_range` filter.
 */
function formatDate8(d: Date): string {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Builds the `filter` query parameter for getTrafficReport per eBay's
 * documented Analytics API format:
 * - date_range:[YYYYMMDD..YYYYMMDD] (8-digit dates)
 * - listing_ids:{id1|id2|id3} (plural key, braces, pipe-separated)
 *
 * Docs: https://developer.ebay.com/api-docs/sell/analytics/resources/traffic_report/methods/getTrafficReport
 */
export function buildTrafficFilter(startDate: Date, endDate: Date, ebayItemIds: string[]): string {
  const dateRange = `date_range:[${formatDate8(startDate)}..${formatDate8(endDate)}]`;
  const listingIds = `listing_ids:{${ebayItemIds.join('|')}}`;
  return `${dateRange},${listingIds}`;
}

/**
 * Fetches real traffic data (impressions, clicks, CTR) from the eBay Analytics API.
 * This is far more accurate than watcher counts for understanding listing visibility.
 *
 * Docs: https://developer.ebay.com/api-docs/sell/analytics/resources/traffic_report/methods/getTrafficReport
 */
export async function getTrafficReport(
  accessToken: string,
  ebayItemIds: string[]
): Promise<Map<string, ListingTrafficData>> {
  const result = new Map<string, ListingTrafficData>();
  if (ebayItemIds.length === 0) return result;

  // Build date range: last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);

  const url = new URL('https://api.ebay.com/sell/analytics/v1/traffic_report');
  url.searchParams.set('dimension', 'LISTING');
  url.searchParams.set(
    'metric',
    'LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,CLICK_THROUGH_RATE'
  );
  url.searchParams.set('filter', buildTrafficFilter(startDate, endDate, ebayItemIds));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Non-fatal for the cron: log status + body so failures are visible in
    // Vercel logs, but return an empty map so the caller can proceed without
    // traffic data instead of failing the whole run.
    console.error(`Analytics API failed: status=${res.status} body=${body}`);
    return result;
  }

  const data = await res.json();

  // The response structure: { dimensionValueData: [ { dimensionValue: {value: itemId}, metricData: [...] } ] }
  const rows: any[] = data.dimensionValueData ?? [];

  for (const row of rows) {
    const itemId = String(row.dimensionValue?.value ?? '');
    if (!itemId) continue;

    let impressionCount = 0;
    let clickCount = 0;
    let clickThroughRate = 0;

    for (const metric of row.metricData ?? []) {
      const name: string = metric.metric ?? '';
      const val = parseFloat(metric.value ?? '0') || 0;
      if (name === 'LISTING_IMPRESSION_TOTAL') impressionCount = val;
      else if (name === 'LISTING_VIEWS_TOTAL') clickCount = val;
      else if (name === 'CLICK_THROUGH_RATE') clickThroughRate = val * 100; // convert 0-1 to 0-100
    }

    result.set(itemId, { itemId, impressionCount, clickCount, clickThroughRate });
  }

  return result;
}
