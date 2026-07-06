import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshAccessToken } from './ebayOAuth';
import { getSellingSnapshot } from './ebayTrading';

export interface CollectMetricsResult {
  collected: number;
  errors: string[];
}

export async function collectDailyMetrics(supabase: SupabaseClient, chatId: number): Promise<CollectMetricsResult> {
  const { data: connection } = await supabase
    .from('ebay_connection')
    .select('refresh_token')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!connection?.refresh_token) {
    return { collected: 0, errors: [] };
  }

  let accessToken: string;
  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    accessToken = tokens.accessToken;
  } catch (err) {
    return { collected: 0, errors: [`Rinnovo token eBay fallito: ${(err as Error).message}`] };
  }

  const { data: listings } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, title')
    .eq('chat_id', chatId)
    .eq('status', 'active');

  const snapshot = await getSellingSnapshot(accessToken);
  const snapshotById = new Map(snapshot.listings.map((item) => [item.itemId, item]));
  const soldById = new Map(snapshot.soldItems.map((item) => [item.itemId, item]));

  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  let collected = 0;

  for (const listing of listings ?? []) {
    const snapshotItem = snapshotById.get(listing.ebay_item_id);
    if (!snapshotItem) {
      errors.push(`Prodotto ${listing.title}: non trovato tra le inserzioni attive eBay`);
      continue;
    }
    const sold = soldById.get(listing.ebay_item_id);

    await supabase.from('daily_metrics').upsert(
      {
        listing_id: listing.id,
        metric_date: today,
        watch_count: snapshotItem.watchCount,
        quantity_sold: sold?.quantitySold ?? 0,
        revenue: sold?.revenue ?? 0,
        price: snapshotItem.price,
      },
      { onConflict: 'listing_id,metric_date' }
    );
    collected += 1;
  }

  return { collected, errors };
}
