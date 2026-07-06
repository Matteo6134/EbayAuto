import type { CommandHandler } from './types';
import { extractItemId, fetchListingSummary } from '@/lib/ebay';

export const handleAddProduct: CommandHandler = async ({ supabase, chatId, args }) => {
  const itemId = extractItemId(args);
  if (!itemId) {
    return { text: 'Uso: /addproduct <link o ID eBay>. Non ho riconosciuto un ID valido.' };
  }

  let listing;
  try {
    listing = await fetchListingSummary(itemId);
  } catch (err) {
    return { text: `Non sono riuscito a trovare l'inserzione: ${(err as Error).message}` };
  }

  const { data: existing } = await supabase
    .from('watched_listings')
    .select('id')
    .eq('ebay_item_id', itemId)
    .maybeSingle();

  if (existing) {
    return { text: `"${listing.title}" è già monitorato (id ${existing.id}).` };
  }

  const { data: inserted, error } = await supabase
    .from('watched_listings')
    .insert({
      ebay_item_id: itemId,
      title: listing.title,
      category_id: listing.categoryId,
      chat_id: chatId,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    return { text: `Errore nel salvare il prodotto: ${error.message}` };
  }

  return {
    text: `✅ Aggiunto ai prodotti monitorati (id ${inserted.id}):\n${listing.title}\nCategoria: ${listing.categoryName}\nPrezzo: ${listing.price} ${listing.currency}`,
  };
};
