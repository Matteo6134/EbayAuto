import type { CommandHandler } from './types';
import { refreshAccessToken } from '@/lib/ebayOAuth';
import { getExistingItemDetails, reviseWithVariations } from '@/lib/ebayRevise';

const USAGE_TEXT = 'Uso: /setvariants <id> <NomeOpzione>; <Valore>=<prezzo>; <Valore>=<prezzo>';

interface ParsedVariant {
  value: string;
  price: number;
}

interface ParsedArgs {
  id: number;
  optionName: string;
  variants: ParsedVariant[];
}

function parseArgs(raw: string): ParsedArgs | null {
  const trimmed = raw.trim();
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) return null;

  const idPart = trimmed.slice(0, firstSpace);
  const rest = trimmed.slice(firstSpace + 1).trim();

  const id = Number(idPart);
  if (!Number.isInteger(id)) return null;
  if (!rest) return null;

  const segments = rest
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 3) return null; // option name + at least 2 variants

  const [optionName, ...variantSegments] = segments;
  if (!optionName || optionName.includes('=')) return null;

  if (variantSegments.length < 2 || variantSegments.length > 10) return null;

  const variants: ParsedVariant[] = [];
  for (const segment of variantSegments) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex === -1) return null;
    const value = segment.slice(0, eqIndex).trim();
    const priceRaw = segment.slice(eqIndex + 1).trim();
    if (!value || !priceRaw) return null;
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) return null;
    variants.push({ value, price });
  }

  return { id, optionName, variants };
}

export const handleSetVariants: CommandHandler = async ({ supabase, chatId, args }) => {
  const parsed = parseArgs(args);
  if (!parsed) {
    return { text: USAGE_TEXT };
  }
  const { id, optionName, variants } = parsed;

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

    const details = await getExistingItemDetails(tokens.accessToken, listing.ebay_item_id);

    if (details && details.quantitySold > 0) {
      return {
        text: '⚠️ Questa inserzione ha già vendite: eBay non permette di convertirla in inserzione con varianti. Serve una nuova inserzione.',
      };
    }

    const quantityPerVariant = Math.max(1, details?.quantity ?? 1);

    await reviseWithVariations(tokens.accessToken, listing.ebay_item_id, optionName, variants, quantityPerVariant);

    const title = details?.title || `inserzione ${id}`;
    const variantsSummary = variants.map((v) => `${v.value} €${v.price.toFixed(2)}`).join(', ');

    return {
      text: `✅ Varianti create per ${title}: ${variantsSummary}. ⚠️ Nota: da ora le proposte automatiche di prezzo per questa inserzione potrebbero non essere applicabili (i prezzi vivono sulle singole varianti).`,
    };
  } catch (err) {
    return { text: `${(err as Error).message}` };
  }
};
