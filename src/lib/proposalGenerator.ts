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

/** How long an identical informational note stays suppressed after being shown once. */
const INFORMATIONAL_DEDUP_DAYS = 7;

function daysAgoDateString(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

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
      // Dedup: an identical informational note (same listing + field + value +
      // rationale) shown in the last N days is skipped entirely — not
      // inserted again, not added to the recap — so each distinct piece of
      // advice appears once and then goes quiet for a week.
      const { data: recentDuplicate } = await supabase
        .from('proposals')
        .select('id')
        .eq('listing_id', listingId)
        .eq('field', draft.field)
        .eq('proposed_value', draft.proposedValue)
        .eq('rationale', draft.rationale)
        .eq('status', 'informational')
        .gte('proposal_date', daysAgoDateString(INFORMATIONAL_DEDUP_DAYS))
        .maybeSingle();

      if (recentDuplicate) {
        continue;
      }

      await supabase.from('proposals').insert({
        listing_id: listingId,
        proposal_date: today,
        field: draft.field,
        current_value: draft.currentValue,
        proposed_value: draft.proposedValue,
        rationale: draft.rationale,
        impact: draft.impact,
        status: 'informational',
      });

      const fieldLabel = FIELD_LABELS[draft.field] ?? draft.field;
      informational.push(`${snapshot.title} (${fieldLabel}): ${draft.rationale}`);
      continue;
    }

    // Controlla se esiste già una proposta pending per questo prodotto e questo campo
    const { data: existingPending } = await supabase
      .from('proposals')
      .select('id, proposed_value, telegram_message_id')
      .eq('listing_id', listingId)
      .eq('field', draft.field)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingPending) {
      if (existingPending.proposed_value === draft.proposedValue) {
        if (existingPending.telegram_message_id == null) {
          // The DB insert previously succeeded but the Telegram send never
          // did (or its message id was never saved) — the row would
          // otherwise be orphaned forever since dedup keeps skipping it.
          // Re-attempt the send now and persist the message id on success.
          const impactPrefix = draft.impact === 'high' ? '⚠️ Alto impatto\n' : '';
          const text = `${impactPrefix}📋 ${snapshot.title}\nCampo: ${draft.field}\nAttuale: ${draft.currentValue} → Proposto: ${draft.proposedValue}\nMotivo: ${draft.rationale}`;
          try {
            const messageId = await sendMessage(chatId, text, {
              inline_keyboard: [
                [
                  { text: '✅ Approva', callback_data: `proposal:${existingPending.id}:approve` },
                  { text: '❌ Rifiuta', callback_data: `proposal:${existingPending.id}:reject` },
                ],
              ],
            });
            if (messageId != null) {
              await supabase.from('proposals').update({ telegram_message_id: messageId }).eq('id', existingPending.id);
            }
          } catch (err) {
            console.error(`Reinvio Telegram fallito per proposta pending orfana ${existingPending.id}:`, err);
          }
        }
        // Stesso valore proposto già pendente: saltiamo l'inserimento per evitare spam
        sent += 1;
        continue;
      } else {
        // Smorzamento per le proposte di prezzo: la media di mercato oscilla
        // ogni giorno, quindi un prezzo proposto leggermente diverso NON è una
        // novità — riproponiamo solo se differisce di oltre il 5% dal valore
        // già pendente, altrimenti teniamo viva la proposta esistente.
        if (draft.field === 'price') {
          const oldValue = Number(existingPending.proposed_value);
          const newValue = Number(draft.proposedValue);
          if (
            Number.isFinite(oldValue) &&
            Number.isFinite(newValue) &&
            oldValue > 0 &&
            Math.abs(newValue - oldValue) / oldValue <= 0.05
          ) {
            // Variazione trascurabile: salta senza cancellare né reinviare
            sent += 1;
            continue;
          }
        }
        // Valore diverso in modo sostanziale: eliminiamo la vecchia proposta pendente obsoleta
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

    const messageId = await sendMessage(chatId, text, {
      inline_keyboard: [
        [
          { text: '✅ Approva', callback_data: `proposal:${inserted.id}:approve` },
          { text: '❌ Rifiuta', callback_data: `proposal:${inserted.id}:reject` },
        ],
      ],
    });
    if (messageId != null) {
      await supabase.from('proposals').update({ telegram_message_id: messageId }).eq('id', inserted.id);
    }
    sent += 1;
  }

  return { sent, informational };
}

/** Pending proposals older than this are auto-rejected so they don't linger forever. */
const PENDING_EXPIRY_DAYS = 14;

/**
 * Auto-rejects 'pending' proposals older than PENDING_EXPIRY_DAYS. Meant to
 * be called once per cron run (not per listing). Returns the number of
 * proposals expired, and logs a brief line when any are found.
 */
export async function expireStalePendingProposals(supabase: SupabaseClient): Promise<number> {
  const cutoff = daysAgoDateString(PENDING_EXPIRY_DAYS);

  const { data: stale } = await supabase
    .from('proposals')
    .select('id')
    .eq('status', 'pending')
    .lt('proposal_date', cutoff);

  const staleIds = (stale ?? []).map((row: { id: number }) => row.id);
  if (staleIds.length === 0) return 0;

  const { error } = await supabase.from('proposals').update({ status: 'rejected' }).in('id', staleIds);
  if (error) {
    console.error('expireStalePendingProposals: aggiornamento stato fallito', error);
    return 0;
  }

  console.log(`expireStalePendingProposals: ${staleIds.length} proposte pending scadute (>${PENDING_EXPIRY_DAYS}gg) marcate come rejected`);
  return staleIds.length;
}
