import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { exchangeCodeForTokens } from '@/lib/ebayOAuth';
import { sendMessage } from '@/lib/telegram';

function htmlResponse(message: string, status: number) {
  return new NextResponse(`<!doctype html><html lang="it"><body><p>${message}</p></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');

  if (!code || !state) {
    return htmlResponse('Parametri mancanti nella risposta di eBay.', 400);
  }

  const supabase = getSupabaseClient();
  const { data: connection, error: lookupError } = await supabase
    .from('ebay_connection')
    .select('chat_id')
    .eq('pending_state', state)
    .maybeSingle();

  if (lookupError || !connection) {
    return htmlResponse('Collegamento non riconosciuto o scaduto. Riprova con /connectebay su Telegram.', 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refreshToken) {
      return htmlResponse('Collegamento a eBay fallito: eBay non ha fornito un refresh_token. Vai nelle impostazioni del tuo account eBay, rimuovi l\\'autorizzazione per questa app e riprova con /connectebay.', 400);
    }

    const { error: updateError } = await supabase
      .from('ebay_connection')
      .update({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        access_token_expires_at: tokens.accessTokenExpiresAt,
        connected_at: new Date().toISOString(),
        pending_state: null,
        pending_state_created_at: null,
      })
      .eq('chat_id', connection.chat_id);

    if (updateError) {
      throw new Error(`Salvataggio token fallito: ${updateError.message}`);
    }

    await sendMessage(connection.chat_id, '✅ Account eBay collegato con successo. Ora puoi usare /scanproducts.');
  } catch (err) {
    console.error('eBay OAuth callback: errore durante lo scambio del token', err);
    return htmlResponse(`Errore durante il collegamento con eBay: ${(err as Error).message}`, 500);
  }

  return htmlResponse('Account eBay collegato con successo. Puoi tornare su Telegram.', 200);
}
