import type { CommandHandler } from './types';
import { buildDailySummaryText } from '@/lib/recap';

export const handleRecap: CommandHandler = async ({ supabase, chatId, args }) => {
  const id = Number(args.trim());
  if (!Number.isInteger(id)) {
    return { text: 'Uso: /recap <id>' };
  }

  const { data: listing } = await supabase
    .from('watched_listings')
    .select('id, title')
    .eq('id', id)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!listing) {
    return { text: `Nessun prodotto trovato con id ${id}.` };
  }

  const { data: history } = await supabase
    .from('daily_metrics')
    .select('metric_date, watch_count, quantity_sold, revenue')
    .eq('listing_id', id)
    .order('metric_date', { ascending: true });

  const rows = history ?? [];
  if (rows.length === 0) {
    return { text: `Nessuna metrica ancora raccolta per questo prodotto (${listing.title}).` };
  }

  const today = rows[rows.length - 1];
  const pastRows = rows.slice(0, -1);
  const avgWatch =
    pastRows.length > 0 ? pastRows.reduce((sum: number, r: any) => sum + r.watch_count, 0) / pastRows.length : 0;

  const text = buildDailySummaryText([
    {
      title: listing.title,
      today: { watchCount: today.watch_count, quantitySold: today.quantity_sold, revenue: today.revenue },
      avgWatch,
      informationalNotes: [],
    },
  ]);

  return { text };
};
