import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { reviseListingField } from '@/lib/ebayRevise';

const USAGE_TEXT = 'Uso: /setbestoffer <id> [autoaccetta=<prezzo>] [minimo=<prezzo>]';

interface ParsedArgs {
  id: number;
  autoAccept: number | null;
  minimum: number | null;
}

function parseArgs(raw: string): ParsedArgs | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  const [idPart, ...rest] = parts;
  const id = Number(idPart);
  if (!Number.isInteger(id)) return null;

  let autoAccept: number | null = null;
  let minimum: number | null = null;

  for (const token of rest) {
    const eqIndex = token.indexOf('=');
    if (eqIndex === -1) return null;
    const key = token.slice(0, eqIndex).trim().toLowerCase();
    const valueRaw = token.slice(eqIndex + 1).trim();
    const value = Number(valueRaw);
    if (!valueRaw || !Number.isFinite(value) || value <= 0) return null;

    if (key === 'autoaccetta') {
      autoAccept = value;
    } else if (key === 'minimo') {
      minimum = value;
    } else {
      return null;
    }
  }

  return { id, autoAccept, minimum };
}

export const handleSetBestOffer: CommandHandler = async ({ supabase, chatId, args }) => {
  const parsed = parseArgs(args);
  if (!parsed) {
    return { text: USAGE_TEXT };
  }
  const { id, autoAccept, minimum } = parsed;

  if (autoAccept !== null && minimum !== null && minimum >= autoAccept) {
    return { text: 'Il prezzo minimo deve essere inferiore a quello di auto-accettazione.' };
  }

  const { data: listing, error: listingError } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, title')
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

  let fieldXml = '<BestOfferDetails><BestOfferEnabled>true</BestOfferEnabled></BestOfferDetails>';

  if (autoAccept !== null || minimum !== null) {
    const listingDetailsParts: string[] = [];
    if (autoAccept !== null) {
      listingDetailsParts.push(`<BestOfferAutoAcceptPrice>${autoAccept.toFixed(2)}</BestOfferAutoAcceptPrice>`);
    }
    if (minimum !== null) {
      listingDetailsParts.push(`<MinimumBestOfferPrice>${minimum.toFixed(2)}</MinimumBestOfferPrice>`);
    }
    fieldXml += `\n<ListingDetails>\n  ${listingDetailsParts.join('\n  ')}\n</ListingDetails>`;
  }

  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    await reviseListingField(tokens.accessToken, listing.ebay_item_id, fieldXml);
  } catch (err) {
    return { text: `${(err as Error).message}` };
  }

  let text = `✅ Proposta d'acquisto attivata su ${listing.title}.`;
  if (autoAccept !== null) {
    text += ` Auto-accetta da €${autoAccept.toFixed(2)}.`;
  }
  if (minimum !== null) {
    text += ` Rifiuta sotto €${minimum.toFixed(2)}.`;
  }

  return { text };
};
