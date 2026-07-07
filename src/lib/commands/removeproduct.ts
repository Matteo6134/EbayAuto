import type { CommandHandler } from './types';

export const handleRemove: CommandHandler = async ({ supabase, chatId, args }) => {
  const id = Number(args.trim());
  if (!Number.isInteger(id)) {
    return { text: 'Uso: /remove <id>' };
  }

  const { data, error } = await supabase
    .from('watched_listings')
    .delete()
    .eq('id', id)
    .eq('chat_id', chatId)
    .select('title')
    .maybeSingle();

  if (error) {
    return { text: `Errore durante l'eliminazione: ${error.message}` };
  }
  if (!data) {
    return { text: `Nessun prodotto trovato con id ${id}.` };
  }

  return { text: `🗑️ Prodotto eliminato dal monitoraggio: ${data.title}` };
};
