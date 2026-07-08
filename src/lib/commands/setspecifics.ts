import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { reviseItemSpecifics } from '@/lib/ebayRevise';

function parseSpecifics(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const segment of raw.split(';')) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment) continue;
    const eqIndex = trimmedSegment.indexOf('=');
    if (eqIndex === -1) continue;
    const name = trimmedSegment.slice(0, eqIndex).trim();
    const value = trimmedSegment.slice(eqIndex + 1).trim();
    if (!name || !value) continue;
    result[name] = value;
  }
  return result;
}

export const handleSetSpecifics: CommandHandler = async ({ supabase, chatId, args }) => {
  const trimmed = args.trim();
  const firstSpace = trimmed.indexOf(' ');
  const idPart = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const specificsRaw = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  const id = Number(idPart);
  const specifics = parseSpecifics(specificsRaw);

  if (!Number.isInteger(id) || Object.keys(specifics).length === 0) {
    return { text: 'Uso: /setspecifics <id> Nome=Valore; Nome=Valore' };
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
    await reviseItemSpecifics(tokens.accessToken, listing.ebay_item_id, specifics);
  } catch (err) {
    return { text: `${(err as Error).message}` };
  }

  const applied = Object.entries(specifics)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');

  return { text: `✅ Specifiche aggiornate: ${applied}` };
};
