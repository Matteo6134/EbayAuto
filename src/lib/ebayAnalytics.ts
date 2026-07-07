export interface ListingTrafficData {
  itemId: string;
  impressionCount: number;
  clickCount: number;
  clickThroughRate: number; // percentage 0-100
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

  const fmt = (d: Date) =>
    d.toISOString().split('T')[0].replace(/-/g, '') + '000000'; // yyyyMMddHHmmss format

  // Filter by listing IDs
  const listingFilter = ebayItemIds.map((id) => `listing_id:${id}`).join(',');

  const url = new URL('https://api.ebay.com/sell/analytics/v1/traffic_report');
  url.searchParams.set('dimension', 'LISTING');
  url.searchParams.set(
    'metric',
    'IMPRESSION_COUNT,CLICK_COUNT,CLICK_THROUGH_RATE'
  );
  url.searchParams.set(
    'filter',
    `date_range:[${fmt(startDate)}..${fmt(endDate)}],${listingFilter}`
  );

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
    console.error(`Analytics API failed: ${res.status} ${body}`);
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
      if (name === 'IMPRESSION_COUNT') impressionCount = val;
      else if (name === 'CLICK_COUNT') clickCount = val;
      else if (name === 'CLICK_THROUGH_RATE') clickThroughRate = val * 100; // convert 0-1 to 0-100
    }

    result.set(itemId, { itemId, impressionCount, clickCount, clickThroughRate });
  }

  return result;
}
