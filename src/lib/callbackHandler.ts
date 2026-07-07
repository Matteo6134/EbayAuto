import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshAccessToken } from './ebayOAuth';
import { applyProposal } from './ebayRevise';
import { buildProductListMessage, buildProductItemMessage } from './commands/listproducts';
import { handlePause, handleResume } from './commands/pauseresume';
import { handleRemove } from './commands/removeproduct';
import { handleRecap } from './commands/recap';

export interface CallbackResult {
  chatId: number;
  text: string;
  replyMarkup?: any;
  editMessage?: boolean;
}

export async function handleCallback(
  supabase: SupabaseClient,
  callbackData: string,
  chatId: number
): Promise<CallbackResult | null> {
  if (callbackData.startsWith('proposal:')) {
    return handleProposalCallback(supabase, callbackData, chatId);
  }
  if (callbackData.startsWith('manage_')) {
    return handleManageCallback(supabase, callbackData, chatId);
  }
  return null;
}

async function handleManageCallback(
  supabase: SupabaseClient,
  callbackData: string,
  chatId: number
): Promise<CallbackResult | null> {
  if (callbackData.startsWith('manage_list:')) {
    const page = Number(callbackData.split(':')[1]);
    const res = await buildProductListMessage(supabase, chatId, page);
    return { chatId, text: res.text, replyMarkup: res.replyMarkup, editMessage: true };
  }

  if (callbackData.startsWith('manage_item:')) {
    const id = Number(callbackData.split(':')[1]);
    const res = await buildProductItemMessage(supabase, chatId, id);
    return { chatId, text: res.text, replyMarkup: res.replyMarkup, editMessage: true };
  }

  if (callbackData.startsWith('manage_action:')) {
    const [, action, idStr] = callbackData.split(':');
    const id = Number(idStr);
    
    let resText = '';
    const mockCtx = { supabase, chatId, args: idStr };

    if (action === 'pause') resText = (await handlePause(mockCtx)).text;
    else if (action === 'resume') resText = (await handleResume(mockCtx)).text;
    else if (action === 'remove') {
      resText = (await handleRemove(mockCtx)).text;
      const listRes = await buildProductListMessage(supabase, chatId, 0);
      return { chatId, text: `${resText}\n\n${listRes.text}`, replyMarkup: listRes.replyMarkup, editMessage: true };
    }
    else if (action === 'recap') {
      resText = (await handleRecap(mockCtx)).text;
      const itemRes = await buildProductItemMessage(supabase, chatId, id);
      return { chatId, text: `${resText}\n\n${itemRes.text}`, replyMarkup: itemRes.replyMarkup, editMessage: true };
    }

    // Refresh the item menu
    const itemRes = await buildProductItemMessage(supabase, chatId, id);
    return { chatId, text: `${resText}\n\n${itemRes.text}`, replyMarkup: itemRes.replyMarkup, editMessage: true };
  }

  return null;
}

async function handleProposalCallback(
  supabase: SupabaseClient,
  callbackData: string,
  chatIdFromCallback: number
): Promise<CallbackResult | null> {
  const match = callbackData.match(/^proposal:(\d+):(approve|reject)$/);
  if (!match) {
    return null;
  }
  const proposalId = Number(match[1]);
  const action = match[2];

  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, listing_id, field, proposed_value, current_value, status')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal) {
    return { chatId: chatIdFromCallback, text: 'Proposta non trovata.' };
  }
  if (proposal.status !== 'pending') {
    return { chatId: chatIdFromCallback, text: `Questa proposta è già stata gestita (stato: ${proposal.status}).` };
  }

  const { data: listing } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, chat_id, title')
    .eq('id', proposal.listing_id)
    .maybeSingle();

  if (!listing) {
    return { chatId: chatIdFromCallback, text: 'Prodotto associato non trovato.' };
  }

  if (action === 'reject') {
    await supabase.from('proposals').update({ status: 'rejected' }).eq('id', proposalId);
    return { chatId: listing.chat_id, text: `❌ Proposta rifiutata: ${listing.title}` };
  }

  const { data: connection } = await supabase
    .from('ebay_connection')
    .select('refresh_token')
    .eq('chat_id', listing.chat_id)
    .maybeSingle();

  if (!connection?.refresh_token) {
    return { chatId: listing.chat_id, text: 'Nessun account eBay collegato, impossibile applicare la modifica.' };
  }

  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    await applyProposal(tokens.accessToken, listing.ebay_item_id, proposal.field, proposal.proposed_value);

    // Sync the change back to our local watched_listings record
    if (proposal.field === 'category') {
      await supabase.from('watched_listings').update({ category_id: proposal.proposed_value }).eq('id', proposal.listing_id);
    } else if (proposal.field === 'title') {
      await supabase.from('watched_listings').update({ title: proposal.proposed_value }).eq('id', proposal.listing_id);
    } else if (proposal.field === 'price') {
      // price is tracked via daily_metrics; no need to update watched_listings
    }

    const { error: statusError } = await supabase.from('proposals').update({ status: 'applied' }).eq('id', proposalId);
    const { error: logError } = await supabase.from('change_log').insert({
      listing_id: proposal.listing_id,
      proposal_id: proposalId,
      field: proposal.field,
      previous_value: proposal.current_value,
      new_value: proposal.proposed_value,
    });

    if (statusError || logError) {
      console.error(
        'handleProposalCallback: modifica applicata su eBay ma registrazione interna fallita',
        statusError ?? logError
      );
      return {
        chatId: listing.chat_id,
        text: `⚠️ Modifica applicata su eBay (${proposal.field} aggiornato a ${proposal.proposed_value}) ma la registrazione interna è fallita. Non approvare di nuovo questa proposta.`,
      };
    }

    return {
      chatId: listing.chat_id,
      text: `✅ Applicato: ${listing.title} — ${proposal.field} aggiornato a ${proposal.proposed_value}`,
    };
  } catch (err) {
    await supabase.from('proposals').update({ status: 'failed' }).eq('id', proposalId);
    return { chatId: listing.chat_id, text: `⚠️ Errore nell'applicare la modifica: ${(err as Error).message}` };
  }
}
