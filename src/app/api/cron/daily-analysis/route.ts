import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals, expireStalePendingProposals } from '@/lib/proposalGenerator';
import { sendMessage, getDashboardUrl } from '@/lib/telegram';
import { buildDailySummaryText, type ListingRecapData } from '@/lib/recap';
import { refreshAccessToken } from '@/lib/ebayOAuth';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const chatId = Number(process.env.TELEGRAM_OWNER_CHAT_ID);
  const supabase = getSupabaseClient();

  await collectDailyMetrics(supabase, chatId);
  await expireStalePendingProposals(supabase);

  const { data: listings } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, title, category_id')
    .eq('chat_id', chatId)
    .eq('status', 'active');

  const todayDateString = new Date().toISOString().slice(0, 10);
  const recapData: ListingRecapData[] = [];

  // Refresh the eBay access token once per run, not once per listing:
  // repeated per-listing refreshes were wasteful and risked throttling.
  let sharedAccessToken: string | null = null;
  try {
    const { data: connection } = await supabase
      .from('ebay_connection')
      .select('refresh_token')
      .eq('chat_id', chatId)
      .maybeSingle();
    if (connection?.refresh_token) {
      const tokens = await refreshAccessToken(connection.refresh_token);
      sharedAccessToken = tokens.accessToken;
    }
  } catch (err) {
    console.error('Cron giornaliero: rinnovo token eBay fallito', err);
  }

  for (const listing of listings ?? []) {
    const { data: history } = await supabase
      .from('daily_metrics')
      .select('metric_date, watch_count, quantity_sold, revenue, price, ad_rate_percent, impression_count, click_count, click_through_rate')
      .eq('listing_id', listing.id)
      .order('metric_date', { ascending: true });

    const rows = history ?? [];
    const today = rows[rows.length - 1];
    if (!today) continue;
    // Guard against treating a stale row as "today": if the latest
    // daily_metrics row isn't actually dated today (e.g. today's collection
    // failed for this listing), skip analysis rather than re-analyzing
    // yesterday's data as if it were current.
    if (today.metric_date !== todayDateString) continue;
    const pastRows = rows.slice(0, -1);
    const avgWatch =
      pastRows.length > 0 ? pastRows.reduce((sum: number, r: any) => sum + r.watch_count, 0) / pastRows.length : 0;

    const snapshot = {
      listingId: listing.id,
      ebayItemId: listing.ebay_item_id,
      title: listing.title,
      categoryId: listing.category_id ? String(listing.category_id) : null,
      today: {
        metricDate: today.metric_date,
        watchCount: today.watch_count,
        quantitySold: today.quantity_sold,
        revenue: today.revenue,
        price: today.price,
        adRatePercent: today.ad_rate_percent,
        impressionCount: today.impression_count ?? null,
        clickCount: today.click_count ?? null,
        clickThroughRate: today.click_through_rate ?? null,
      },
      history: pastRows.map((r: any) => ({
        metricDate: r.metric_date,
        watchCount: r.watch_count,
        quantitySold: r.quantity_sold,
        revenue: r.revenue,
        price: r.price,
        adRatePercent: r.ad_rate_percent,
        impressionCount: r.impression_count ?? null,
        clickCount: r.click_count ?? null,
        clickThroughRate: r.click_through_rate ?? null,
      })),
    };

    let informational: string[] = [];
    try {
      if (sharedAccessToken) {
        const result = await generateAndSendProposals(supabase, chatId, listing.id, snapshot, sharedAccessToken);
        informational = result.informational;
      }
    } catch (err) {
      console.error(`Cron giornaliero: generazione proposte fallita per il prodotto ${listing.title}`, err);
    }

    recapData.push({
      title: listing.title,
      today: { watchCount: today.watch_count, quantitySold: today.quantity_sold, revenue: today.revenue },
      avgWatch,
      informationalNotes: informational,
    });
  }

  await sendMessage(chatId, buildDailySummaryText(recapData), {
    inline_keyboard: [[
      { text: '📊 Apri Dashboard', web_app: { url: getDashboardUrl() } },
    ]],
  });

  return NextResponse.json({ ok: true });
}
