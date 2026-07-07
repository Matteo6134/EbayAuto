import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandResult } from './commands/types';
import { handleAddProduct } from './commands/addproduct';
import { handleListProducts } from './commands/listproducts';
import { handlePause, handleResume } from './commands/pauseresume';
import { handleConnectEbay } from './commands/connectebay';
import { handleScanProducts } from './commands/scanproducts';
import { handleRecap } from './commands/recap';
import { handleRemove } from './commands/removeproduct';

const HELP_TEXT = `Comandi disponibili:
/addproduct <link o ID eBay> - inizia a monitorare un prodotto
/listproducts - elenco prodotti monitorati
/pause <id> - metti in pausa un prodotto
/resume <id> - riprendi il monitoraggio
/remove <id> - elimina un prodotto dal monitoraggio
/connectebay - collega il tuo account eBay
/scanproducts - aggiunge automaticamente le inserzioni attive del tuo account eBay collegato
/recap <id> - riepilogo di un prodotto monitorato
/help - questo messaggio`;

const COMMANDS: Record<string, (ctx: CommandContext) => Promise<CommandResult>> = {
  '/start': async () => ({ text: 'Bot attivato. Usa /addproduct <link o ID eBay> per iniziare a monitorare un prodotto.' }),
  '/addproduct': handleAddProduct,
  '/listproducts': handleListProducts,
  '/pause': handlePause,
  '/resume': handleResume,
  '/remove': handleRemove,
  '/connectebay': handleConnectEbay,
  '/scanproducts': handleScanProducts,
  '/recap': handleRecap,
  '/help': async () => ({ text: HELP_TEXT }),
};

export function isAuthorized(chatId: number): boolean {
  return String(chatId) === process.env.TELEGRAM_OWNER_CHAT_ID;
}

export async function routeCommand(supabase: SupabaseClient, chatId: number, text: string): Promise<CommandResult> {
  if (!isAuthorized(chatId)) {
    return { text: 'Non sei autorizzato a usare questo bot.' };
  }
  const [command, ...rest] = text.trim().split(/\s+/);
  const args = rest.join(' ');
  const handler = COMMANDS[command.toLowerCase()];
  if (!handler) {
    return { text: `Comando non riconosciuto: ${command}. Usa /help per la lista dei comandi.` };
  }
  return handler({ supabase, chatId, args });
}
