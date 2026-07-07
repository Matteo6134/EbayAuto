import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeListing, type ListingSnapshot } from './analysisEngine';
import { sendMessage } from './telegram';

export interface GenerateProposalsResult {
  sent: number;
  informational: string[];
}

const FIELD_LABELS: Record<string, string> = {
  title: 'titolo',
  price: 'prezzo',
  category: 'categoria',
  ad_rate: '% ads',
};

export async function generateAndSendProposals(
  supabase: SupabaseClient,
  chatId: number,
  listingId: number,
  snapshot: ListingSnapshot,
  accessToken: string
): Promise<GenerateProposalsResult> {
  const drafts = await analyzeListing(snapshot, accessToken);
  const today = new Date().toISOString().slice(0, 10);
  const informational: string[] = [];
  let sent = 0;

  for (const draft of drafts) {
    if (!draft.actionable) {
      const fieldLabel = FIELD_LABELS[draft.field] ?? draft.field;
      informational.push(`${snapshot.title} (${fieldLabel}): ${draft.rationale}`);
      continue;
    }

    // Controlla se esiste già una proposta pending per questo prodotto e questo campo
    const { data: existingPending } = await supabase
      .from('proposals')
      .select('id, proposed_value')
      .eq('listing_id', listingId)
      .eq('field', draft.field)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingPending) {
      if (existingPending.proposed_value === draft.proposedValue) {
        // Stesso valore proposto già pendente: saltiamo l'inserimento ed il messaggio Telegram per evitare spam
        sent += 1;
        continue;
      } else {
        // Valore diverso: eliminiamo la vecchia proposta pendente obsoleta
        await supabase.from('proposals').delete().eq('id', existingPending.id);
      }
    }

    const { data: inserted, error } = await supabase
      .from('proposals')
      .insert({
        listing_id: listingId,
        proposal_date: today,
        field: draft.field,
        current_value: draft.currentValue,
        proposed_value: draft.proposedValue,
        rationale: draft.rationale,
        impact: draft.impact,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Salvataggio proposta fallito (${draft.field}): ${error.message}`);
    }

    const impactPrefix = draft.impact === 'high' ? '⚠️ Alto impatto\n' : '';
    const text = `${impactPrefix}📋 ${snapshot.title}\nCampo: ${draft.field}\nAttuale: ${draft.currentValue} → Proposto: ${draft.proposedValue}\nMotivo: ${draft.rationale}`;

    await sendMessage(chatId, text, {
      inline_keyboard: [
        [
          { text: '✅ Approva', callback_data: `proposal:${inserted.id}:approve` },
          { text: '❌ Rifiuta', callback_data: `proposal:${inserted.id}:reject` },
        ],
      ],
    });
    sent += 1;
  }

  return { sent, informational };
}
