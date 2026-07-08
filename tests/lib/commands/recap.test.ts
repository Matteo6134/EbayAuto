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
    expect(result.text).toContain('12 osservatori');
  });

  it('segnala se non ci sono ancora metriche raccolte per il prodotto', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 5, title: 'Prodotto A' }, error: null },
      { data: [], error: null },
    ]);

    const result = await handleRecap({ supabase, chatId: 1, args: '5' });

    expect(result.text).toContain('Nessuna metrica ancora raccolta per questo prodotto');
  });

  it('include impression/click/CTR quando i dati Analytics sono disponibili', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 5, title: 'Mercedes W177' }, error: null },
      {
        data: [
          {
            metric_date: '2026-07-01',
            watch_count: 10,
            quantity_sold: 0,
            revenue: 0,
            impression_count: 200,
            click_count: 40,
            click_through_rate: 1.2,
          },
          {
            metric_date: '2026-07-02',
            watch_count: 16,
            quantity_sold: 0,
            revenue: 0,
            impression_count: 224,
            click_count: 53,
            click_through_rate: 1.0,
          },
        ],
        error: null,
      },
    ]);

    const result = await handleRecap({ supabase, chatId: 1, args: '5' });

    expect(result.text).toContain('👁 224 impression · 53 click (CTR 1.0%)');
    expect(result.text).toContain('(impression +12% vs ieri)');
  });
});
