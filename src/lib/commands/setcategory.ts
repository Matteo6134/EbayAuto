import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { applyProposal } from '@/lib/ebayRevise';

export const handleSetCategory: CommandHandler = async ({ supabase, chatId, args }) => {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const [idPart, categoryId] = parts;

  const id = Number(idPart);
  if (!Number.isInteger(id) || !categoryId || !/^\d+$/.test(categoryId)) {
    return { text: 'Uso: /setcategory <id> <categoryId eBay>' };
  }

  const { data: listing, error: listingError } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id')
    .eq('id', id)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (listingError) {
    return { text: `Errore: ${listingError.message}` };
  }
  if (!listing) {
    return { text: `Nessun prodotto trovato con id ${id}.` };
  }

  const { data: connection, error: connectionError } = await supabase
    .from('ebay_connection')
    .select('refresh_token')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (connectionError) {
    return { text: `Errore nel recuperare il collegamento eBay: ${connectionError.message}` };
  }
  if (!connection?.refresh_token) {
    return { text: 'Nessun account eBay collegato. Usa /connectebay.' };
  }

  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    await applyProposal(tokens.accessToken, listing.ebay_item_id, 'category', categoryId);
  } catch (err) {
    return { text: `${(err as Error).message}` };
  }

  const { error: updateError } = await supabase
    .from('watched_listings')
    .update({ category_id: categoryId })
    .eq('id', id)
    .eq('chat_id', chatId);

  if (updateError) {
    return {
      text: `⚠️ Categoria aggiornata su eBay ma il salvataggio locale è fallito: ${updateError.message}`,
    };
  }

  return {
    text: `✅ Categoria aggiornata a ${categoryId}. ⚠️ Nota: il cambio categoria può influire sulla visibilità nelle ricerche nei prossimi giorni.`,
  };
};
