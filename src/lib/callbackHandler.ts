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

export async function handleProposalCallback(
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
    .select('id, ebay_item_id, chat_id, title, category_id')
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

    // Special handling for 'offer' type - uses Negotiation API, not ReviseItem
    if (proposal.field === 'offer') {
      const { sendOfferToWatchers } = await import('./ebayNegotiation');
      let offerData: { discount: number; ebayItemId: string; currentPrice: number };
      try {
        offerData = JSON.parse(proposal.proposed_value);
      } catch {
        return { chatId: listing.chat_id, text: '⚠️ Dati offerta non validi.' };
      }

      const result = await sendOfferToWatchers(
        tokens.accessToken,
        offerData.ebayItemId,
        offerData.currentPrice,
        offerData.discount
      );

      if (!result.success) {
        await supabase.from('proposals').update({ status: 'failed' }).eq('id', proposalId);
        return {
          chatId: listing.chat_id,
          text: `⚠️ Invio offerta fallito: ${result.error}`,
        };
      }

      // Save the offer in sent_offers for tracking
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48);
      await supabase.from('sent_offers').insert({
        listing_id: proposal.listing_id,
        ebay_item_id: offerData.ebayItemId,
        offer_date: new Date().toISOString().slice(0, 10),
        discount_percentage: offerData.discount,
        expires_at: expiresAt.toISOString(),
        status: 'sent',
      });

      await supabase.from('proposals').update({ status: 'applied' }).eq('id', proposalId);
      const discountedPrice = Math.round(offerData.currentPrice * (1 - offerData.discount / 100) * 100) / 100;
      return {
        chatId: listing.chat_id,
        text: `🎯 Offerta inviata! ${listing.title} — ${offerData.discount}% sconto (${discountedPrice.toFixed(2)}€) agli osservatori. Valida 48 ore. Ti avviso se qualcuno accetta!`,
      };
    }

    // Special handling for 'social_boost'
    if (proposal.field === 'social_boost') {
      const { generateSocialPost } = await import('./ebaySocial');
      const post = generateSocialPost(listing.title, 0, listing.category_id ? String(listing.category_id) : null, listing.ebay_item_id, []);
      
      // Update proposal status
      await supabase.from('proposals').update({ status: 'applied' }).eq('id', proposalId);

      // Send the generated text to the user
      await import('./telegram').then(m => m.sendMessage(listing.chat_id, `📱 *Post Social Pronto!*\nCopia e incolla questo testo su Facebook/Instagram:\n\n${post.text}`));

      return {
        chatId: listing.chat_id,
        text: `✅ Post social generato e inviato!`,
      };
    }

    // Special handling for 'relist' (Lazarus module) — EndItem + AddFixedPriceItem
    if (proposal.field === 'relist') {
      const { resurrectionListing } = await import('./ebayLazarus');
      const result = await resurrectionListing(tokens.accessToken, listing.ebay_item_id);

      if (!result.success) {
        await supabase.from('proposals').update({ status: 'failed' }).eq('id', proposalId);
        return {
          chatId: listing.chat_id,
          text: `⚠️ Lazarus fallito: ${result.error}`,
        };
      }

      // Update watched_listings with new eBay item ID
      await supabase
        .from('watched_listings')
        .update({ ebay_item_id: result.newItemId! })
        .eq('id', proposal.listing_id);

      await supabase.from('proposals').update({ status: 'applied' }).eq('id', proposalId);
      await supabase.from('change_log').insert({
        listing_id: proposal.listing_id,
        proposal_id: proposalId,
        field: 'relist',
        previous_value: listing.ebay_item_id,
        new_value: result.newItemId!,
      });

      return {
        chatId: listing.chat_id,
        text: `🧟 Lazarus completato! "${listing.title}" è risorta con un nuovo ID: ${result.newItemId}. Nelle prossime 24-48h riceverà la spinta di visibilità da Cassini per le nuove inserzioni!`,
      };
    }

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
