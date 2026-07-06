import type { SupabaseClient } from '@supabase/supabase-js';

export interface CommandContext {
  supabase: SupabaseClient;
  chatId: number;
  args: string;
}

export interface CommandResult {
  text: string;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;
