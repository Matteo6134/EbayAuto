import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { applyProposal } from '@/lib/ebayRevise';

export const handleSetTitle: CommandHandler = async ({ supabase, chatId, args }) => {
  const trimmed = args.trim();
  const firstSpace = trimmed.indexOf(' ');
  const idPart = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const newTitle = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  const id = Number(idPart);
  if (!Number.isInteger(id) || !newTitle) {
    return { text: 'Uso: /settitle <id> <nuovo titolo>' };
  }

  if (newTitle.length > 80) {
    return { text: `Il titolo supera gli 80 caratteri (attuale: ${newTitle.length}).` };
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
    await applyProposal(tokens.accessToken, listing.ebay_item_id, 'title', newTitle);
  } catch (err) {
    return { text: `${(err as Error).message}` };
  }

  const { error: updateError } = await supabase
    .from('watched_listings')
    .update({ title: newTitle })
    .eq('id', id)
    .eq('chat_id', chatId);

  if (updateError) {
    return {
      text: `⚠️ Titolo aggiornato su eBay ma il salvataggio locale è fallito: ${updateError.message}`,
    };
  }

  return { text: `✅ Titolo aggiornato: ${newTitle}` };
};
