import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandHandler, CommandResult } from './types';

async function setStatus(
  supabase: SupabaseClient,
  chatId: number,
  args: string,
  status: 'active' | 'paused'
): Promise<CommandResult> {
  const id = Number(args.trim());
  const commandName = status === 'paused' ? 'pause' : 'resume';
  if (!Number.isInteger(id)) {
    return { text: `Uso: /${commandName} <id>` };
  }
  const { data, error } = await supabase
    .from('watched_listings')
    .update({ status })
    .eq('id', id)
    .eq('chat_id', chatId)
    .select('id, title')
    .maybeSingle();

  if (error) {
    return { text: `Errore: ${error.message}` };
  }
  if (!data) {
    return { text: `Nessun prodotto trovato con id ${id}.` };
  }
  return { text: `${status === 'paused' ? '⏸️ In pausa' : '▶️ Ripreso'}: ${data.title}` };
}

export const handlePause: CommandHandler = (ctx) => setStatus(ctx.supabase, ctx.chatId, ctx.args, 'paused');
export const handleResume: CommandHandler = (ctx) => setStatus(ctx.supabase, ctx.chatId, ctx.args, 'active');
