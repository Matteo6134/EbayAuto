import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import { buildDailySummaryText, type ListingRecapData } from '@/lib/recap';

export const handleForceScan: CommandHandler = async ({ supabase, chatId }) => {
  try {
    const { collected, errors } = await collectDailyMetrics(supabase, chatId);
    
    if (errors.length > 0) {
      console.error('ForceScan errors:', errors);
      // Non ci fermiamo, cerchiamo di mandare i recap per quelli andati a buon fine
    }

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
        console.error(`ForceScan: generazione proposte fallita per il prodotto ${listing.title}`, err);
      }

      recapData.push({
        title: listing.title,
        today: { watchCount: today.watch_count, quantitySold: today.quantity_sold, revenue: today.revenue },
        avgWatch,
        informationalNotes: informational,
      });
    }

    const text = buildDailySummaryText(recapData);
    const errorText = errors.length > 0 ? `\n\n⚠️ Alcuni errori durante la scansione:\n- ${errors.join('\n- ')}` : '';
    
    return { text: `✅ Scansione forzata completata. Metriche raccolte per ${collected} prodotti.\n\n${text}${errorText}` };

  } catch (err) {
    return { text: `❌ Errore durante la scansione forzata: ${(err as Error).message}` };
  }
};
