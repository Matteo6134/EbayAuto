import { randomBytes } from 'crypto';
import type { CommandHandler } from './types';
import { buildAuthorizeUrl } from '@/lib/ebayOAuth';

export const handleConnectEbay: CommandHandler = async ({ supabase, chatId }) => {
  const state = randomBytes(24).toString('hex');

  const { error } = await supabase.from('ebay_connection').upsert({
    chat_id: chatId,
    pending_state: state,
    pending_state_created_at: new Date().toISOString(),
  });

  if (error) {
    return { text: `Errore nel preparare il collegamento eBay: ${error.message}` };
  }

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl(state);
  } catch (err) {
    return { text: `Errore di configurazione: ${(err as Error).message}` };
  }

  return {
    text: `Per collegare il tuo account eBay, apri questo link e accetta l'autorizzazione:\n${authorizeUrl}`,
  };
};
