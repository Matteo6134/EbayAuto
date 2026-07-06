import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handlePause, handleResume } from '@/lib/commands/pauseresume';

describe('handlePause / handleResume', () => {
  it('chiede un id valido se gli argomenti non sono un numero', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handlePause({ supabase, chatId: 1, args: 'abc' });
    expect(result.text).toContain('Uso: /pause <id>');
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handlePause({ supabase, chatId: 1, args: '99' });
    expect(result.text).toContain('Nessun prodotto trovato con id 99');
  });

  it('mette in pausa un prodotto esistente', async () => {
    const supabase = createFakeSupabase([{ data: { id: 1, title: 'Prodotto A' }, error: null }]);
    const result = await handlePause({ supabase, chatId: 1, args: '1' });
    expect(result.text).toBe('⏸️ In pausa: Prodotto A');
  });

  it('riprende un prodotto esistente', async () => {
    const supabase = createFakeSupabase([{ data: { id: 1, title: 'Prodotto A' }, error: null }]);
    const result = await handleResume({ supabase, chatId: 1, args: '1' });
    expect(result.text).toBe('▶️ Ripreso: Prodotto A');
  });
});
