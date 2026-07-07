import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import { sendMessage } from '@/lib/telegram';
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

  const { data: listings } = await supabase
    .from('watched_listings')
    .select('id, title, category_id')
    .eq('chat_id', chatId)
    .eq('status', 'active');

  const recapData: ListingRecapData[] = [];

  for (const listing of listings ?? []) {
    const { data: history } = await supabase
      .from('daily_metrics')
      .select('metric_date, watch_count, quantity_sold, revenue, price, ad_rate_percent')
      .eq('listing_id', listing.id)
      .order('metric_date', { ascending: true });

    const rows = history ?? [];
    const today = rows[rows.length - 1];
    if (!today) continue;
    const pastRows = rows.slice(0, -1);
    const avgWatch =
      pastRows.length > 0 ? pastRows.reduce((sum: number, r: any) => sum + r.watch_count, 0) / pastRows.length : 0;

    const snapshot = {
      listingId: listing.id,
      title: listing.title,
      categoryId: listing.category_id ? String(listing.category_id) : null,
      today: {
        metricDate: today.metric_date,
        watchCount: today.watch_count,
        quantitySold: today.quantity_sold,
        revenue: today.revenue,
        price: today.price,
        adRatePercent: today.ad_rate_percent,
      },
      history: pastRows.map((r: any) => ({
        metricDate: r.metric_date,
        watchCount: r.watch_count,
        quantitySold: r.quantity_sold,
        revenue: r.revenue,
        price: r.price,
        adRatePercent: r.ad_rate_percent,
      })),
    };

    let informational: string[] = [];
    try {
      const { data: connection } = await supabase.from('ebay_connection').select('refresh_token').eq('chat_id', chatId).maybeSingle();
      if (connection?.refresh_token) {
        const tokens = await refreshAccessToken(connection.refresh_token);
        const result = await generateAndSendProposals(supabase, chatId, listing.id, snapshot, tokens.accessToken);
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

  await sendMessage(chatId, buildDailySummaryText(recapData));

  return NextResponse.json({ ok: true });
}
