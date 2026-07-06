import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshAccessToken } from './ebayOAuth';
import { applyProposal } from './ebayRevise';

export interface CallbackResult {
  chatId: number;
  text: string;
}

export async function handleProposalCallback(
  supabase: SupabaseClient,
  callbackData: string
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
    return { chatId: 0, text: 'Proposta non trovata.' };
  }
  if (proposal.status !== 'pending') {
    return { chatId: 0, text: `Questa proposta è già stata gestita (stato: ${proposal.status}).` };
  }

  const { data: listing } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, chat_id, title')
    .eq('id', proposal.listing_id)
    .maybeSingle();

  if (!listing) {
    return { chatId: 0, text: 'Prodotto associato non trovato.' };
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
