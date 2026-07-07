import type { SupabaseClient } from '@supabase/supabase-js';
import type { InlineKeyboardMarkup } from '../telegram';

export interface CommandContext {
  supabase: SupabaseClient;
  chatId: number;
  args: string;
}

export interface CommandResult {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;
