import type { CommandHandler } from './types';

export const handleListProducts: CommandHandler = async ({ supabase, chatId }) => {
  const { data, error } = await supabase
    .from('watched_listings')
    .select('id, title, status')
    .eq('chat_id', chatId)
    .order('id', { ascending: true });

  if (error) {
    return { text: `Errore nel recuperare i prodotti: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { text: 'Nessun prodotto monitorato. Usa /addproduct <link o ID eBay> per aggiungerne uno.' };
  }
  const lines = data.map((row: { id: number; title: string; status: string }) => `#${row.id} [${row.status}] ${row.title}`);
  return { text: lines.join('\n') };
};
