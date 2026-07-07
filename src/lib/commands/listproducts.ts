import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandHandler, CommandResult } from './types';
import type { InlineKeyboardButton, InlineKeyboardMarkup } from '../telegram';

const ITEMS_PER_PAGE = 5;

export async function buildProductListMessage(
  supabase: SupabaseClient,
  chatId: number,
  page: number
): Promise<{ text: string; replyMarkup?: InlineKeyboardMarkup }> {
  const { data, error, count } = await supabase
    .from('watched_listings')
    .select('id, title, status', { count: 'exact' })
    .eq('chat_id', chatId)
    .order('id', { ascending: true })
    .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

  if (error) {
    return { text: `Errore nel recuperare i prodotti: ${error.message}` };
  }
  if (!data || data.length === 0) {
    if (page > 0) {
      return buildProductListMessage(supabase, chatId, 0); // fallback to page 0
    }
    return { text: 'Nessun prodotto monitorato. Usa /addproduct <link o ID eBay> per aggiungerne uno.' };
  }

  const keyboard: InlineKeyboardButton[][] = data.map((row) => {
    const statusIcon = row.status === 'paused' ? '⏸️' : '▶️';
    // Truncate title to avoid massive buttons
    const shortTitle = row.title.length > 35 ? row.title.substring(0, 32) + '...' : row.title;
    return [{ text: `${statusIcon} ${shortTitle}`, callback_data: `manage_item:${row.id}` }];
  });

  const totalItems = count ?? 0;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  if (totalPages > 1) {
    const navRow: InlineKeyboardButton[] = [];
    if (page > 0) {
      navRow.push({ text: '⬅️ Prec', callback_data: `manage_list:${page - 1}` });
    }
    navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: `manage_list:${page}` });
    if (page < totalPages - 1) {
      navRow.push({ text: 'Succ ➡️', callback_data: `manage_list:${page + 1}` });
    }
    keyboard.push(navRow);
  }

  return {
    text: `📦 *I tuoi prodotti monitorati:*\nSeleziona un prodotto per gestirlo.`,
    replyMarkup: { inline_keyboard: keyboard },
  };
}

export async function buildProductItemMessage(
  supabase: SupabaseClient,
  chatId: number,
  id: number
): Promise<{ text: string; replyMarkup?: InlineKeyboardMarkup }> {
  const { data: listing, error } = await supabase
    .from('watched_listings')
    .select('*')
    .eq('id', id)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error || !listing) {
    return { text: `Prodotto non trovato o errore.` };
  }

  const statusText = listing.status === 'paused' ? '⏸️ In pausa' : '▶️ Attivo';
  const keyboard: InlineKeyboardButton[][] = [];

  keyboard.push([
    { text: '📊 Recap', callback_data: `manage_action:recap:${id}` },
    { text: listing.status === 'paused' ? '▶️ Riprendi' : '⏸️ Pausa', callback_data: `manage_action:${listing.status === 'paused' ? 'resume' : 'pause'}:${id}` }
  ]);
  keyboard.push([
    { text: '🗑️ Elimina', callback_data: `manage_action:remove:${id}` }
  ]);
  keyboard.push([
    { text: '🔙 Torna alla lista', callback_data: 'manage_list:0' }
  ]);

  return {
    text: `📦 *${listing.title}*\n\nStatus: ${statusText}\nScegli un'azione:`,
    replyMarkup: { inline_keyboard: keyboard }
  };
}

export const handleListProducts: CommandHandler = async ({ supabase, chatId }) => {
  const res = await buildProductListMessage(supabase, chatId, 0);
  return { text: res.text, replyMarkup: res.replyMarkup };
};
