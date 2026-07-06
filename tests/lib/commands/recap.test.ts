import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handleRecap } from '@/lib/commands/recap';

describe('handleRecap', () => {
  it('chiede un id valido se gli argomenti non sono un numero', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleRecap({ supabase, chatId: 1, args: 'abc' });
    expect(result.text).toContain('Uso: /recap <id>');
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleRecap({ supabase, chatId: 1, args: '99' });
    expect(result.text).toContain('Nessun prodotto trovato con id 99');
  });

  it('mostra il recap con lo storico disponibile', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 5, title: 'Prodotto A' }, error: null },
      {
        data: [
          { metric_date: '2026-07-01', watch_count: 10, quantity_sold: 0, revenue: 0 },
          { metric_date: '2026-07-02', watch_count: 12, quantity_sold: 1, revenue: 20 },
        ],
        error: null,
      },
    ]);

    const result = await handleRecap({ supabase, chatId: 1, args: '5' });

    expect(result.text).toContain('Prodotto A');
    expect(result.text).toContain('12 watcher');
  });

  it('segnala se non ci sono ancora metriche raccolte per il prodotto', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 5, title: 'Prodotto A' }, error: null },
      { data: [], error: null },
    ]);

    const result = await handleRecap({ supabase, chatId: 1, args: '5' });

    expect(result.text).toContain('Nessuna metrica ancora raccolta per questo prodotto');
  });
});
