import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { getActiveListings } from '@/lib/ebayTrading';

export const handleScanProducts: CommandHandler = async ({ supabase, chatId }) => {
  const { data: connection, error: connectionError } = await supabase
    .from('ebay_connection')
    .select('refresh_token')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (connectionError) {
    return { text: `Errore nel recuperare il collegamento eBay: ${connectionError.message}` };
  }
  if (!connection?.refresh_token) {
    return { text: 'Nessun account eBay collegato. Usa /connectebay prima di scansionare le inserzioni.' };
  }

  let accessToken: string;
  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    accessToken = tokens.accessToken;
    await supabase
      .from('ebay_connection')
      .update({ access_token: tokens.accessToken, access_token_expires_at: tokens.accessTokenExpiresAt })
      .eq('chat_id', chatId);
  } catch (err) {
    return { text: `Errore nel rinnovare il collegamento eBay: ${(err as Error).message}` };
  }

  let listings;
  try {
    listings = await getActiveListings(accessToken);
  } catch (err) {
    return { text: `Errore nel leggere le inserzioni da eBay: ${(err as Error).message}` };
  }

  if (listings.length === 0) {
    return { text: 'Nessuna inserzione attiva trovata sul tuo account eBay.' };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('watched_listings')
    .select('ebay_item_id')
    .eq('chat_id', chatId);

  if (existingError) {
    return { text: `Errore nel controllare i prodotti già monitorati: ${existingError.message}` };
  }

  const existingIds = new Set((existingRows ?? []).map((row: { ebay_item_id: string }) => row.ebay_item_id));
  const newListings = listings.filter((listing) => !existingIds.has(listing.itemId));

  for (const listing of newListings) {
    const { error: insertError } = await supabase.from('watched_listings').insert({
      ebay_item_id: listing.itemId,
      title: listing.title,
      category_id: listing.categoryId,
      chat_id: chatId,
      status: 'active',
    });
    if (insertError) {
      return { text: `Errore nel salvare "${listing.title}": ${insertError.message}` };
    }
  }

  return {
    text: `Scansione completata: ${listings.length} inserzioni trovate, ${newListings.length} aggiunte al monitoraggio (${listings.length - newListings.length} già presenti).`,
  };
};
