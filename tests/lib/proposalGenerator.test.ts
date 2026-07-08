import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';

vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

vi.mock('@/lib/analysisEngine', () => ({
  analyzeListing: vi.fn(),
}));

import { sendMessage } from '@/lib/telegram';
import { analyzeListing, type ListingSnapshot, type MetricPoint, type ProposalDraft } from '@/lib/analysisEngine';
import { generateAndSendProposals, expireStalePendingProposals } from '@/lib/proposalGenerator';

const FAKE_TOKEN = 'fake-token';

function metric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metricDate: '2026-07-01',
    watchCount: 10,
    quantitySold: 0,
    revenue: 0,
    price: 20,
    adRatePercent: null,
    impressionCount: null,
    clickCount: null,
    clickThroughRate: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    listingId: 1,
    ebayItemId: '123456789012',
    title: 'Prodotto Test',
    categoryId: '1',
    today: metric(),
    history: [],
    ...overrides,
  };
}

function draft(overrides: Partial<ProposalDraft> = {}): ProposalDraft {
  return {
    field: 'price',
    currentValue: '20.00',
    proposedValue: '18.00',
    rationale: 'Interesse presente ma nessuna vendita: sconto consigliato.',
    impact: 'normal',
    actionable: true,
    ...overrides,
  };
}

describe('generateAndSendProposals', () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined as any);
    vi.mocked(analyzeListing).mockReset().mockResolvedValue([]);
  });

  it('non manda nulla se il motore non genera proposte', async () => {
    const supabase = createFakeSupabase([]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(analyzeListing).toHaveBeenCalledWith(expect.objectContaining({ listingId: 1 }), FAKE_TOKEN);
    expect(result).toEqual({ sent: 0, informational: [] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come informational e non manda bottoni per una proposta non azionabile mai vista prima', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([
      draft({
        field: 'category',
        currentValue: '1',
        proposedValue: 'rivedi manualmente',
        rationale: 'Nessun interesse riscontrato.',
        impact: 'high',
        actionable: false,
      }),
    ]);
    const supabase = createFakeSupabase([
      { data: null, error: null }, // nessun duplicato informational recente
      { data: null, error: null }, // insert informational
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(0);
    expect(result.informational).toHaveLength(1);
    expect(result.informational[0]).toContain('categoria');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salta completamente una nota informational identica già vista negli ultimi 7 giorni (niente insert, niente recap)', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([
      draft({
        field: 'category',
        currentValue: '1',
        proposedValue: 'rivedi manualmente',
        rationale: 'Nessun interesse riscontrato.',
        impact: 'high',
        actionable: false,
      }),
    ]);
    const supabase = createFakeSupabase([
      { data: { id: 99 }, error: null }, // duplicato informational trovato negli ultimi 7 giorni
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result).toEqual({ sent: 0, informational: [] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come pending, manda un messaggio con bottoni e salva il telegram_message_id per una proposta azionabile', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft()]);
    vi.mocked(sendMessage).mockResolvedValue(555 as any);
    const supabase = createFakeSupabase([
      { data: null, error: null }, // nessuna proposta pending esistente
      { data: { id: 42 }, error: null }, // insert riuscito
      { data: null, error: null }, // update telegram_message_id
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Prodotto Test'),
      {
        inline_keyboard: [
          [
            { text: '✅ Approva', callback_data: 'proposal:42:approve' },
            { text: '❌ Rifiuta', callback_data: 'proposal:42:reject' },
          ],
        ],
      }
    );
  });

  it('salta inserimento e messaggio se esiste già una proposta pending con lo stesso valore e un telegram_message_id salvato', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ proposedValue: '18.00' })]);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00', telegram_message_id: 321 }, error: null }, // pending identica già presente e già notificata
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('ritenta l\'invio Telegram per una proposta pending orfana (stesso valore, telegram_message_id nullo) e salva il nuovo message_id', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ proposedValue: '18.00' })]);
    vi.mocked(sendMessage).mockResolvedValue(777 as any);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00', telegram_message_id: null }, error: null }, // pending orfana: mai notificata
      { data: null, error: null }, // update telegram_message_id
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Prodotto Test'),
      expect.objectContaining({
        inline_keyboard: [
          [
            { text: '✅ Approva', callback_data: 'proposal:7:approve' },
            { text: '❌ Rifiuta', callback_data: 'proposal:7:reject' },
          ],
        ],
      })
    );
  });

  it('non lancia se il reinvio Telegram per una proposta orfana fallisce di nuovo', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ proposedValue: '18.00' })]);
    vi.mocked(sendMessage).mockRejectedValue(new Error('Telegram sendMessage fallita (status 400)'));
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00', telegram_message_id: null }, error: null },
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1); // still counted; dedup will retry again next run
  });

  it('smorzamento prezzo: NON sostituisce una pending se il nuovo prezzo differisce meno del 5%', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ field: 'price', proposedValue: '18.50' })]);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00', telegram_message_id: 111 }, error: null }, // pending esistente, differenza ~2.8%
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled(); // nessun nuovo messaggio: la pending resta viva
  });

  it('smorzamento prezzo: sostituisce la pending se il nuovo prezzo differisce oltre il 5%', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ field: 'price', proposedValue: '15.00' })]);
    vi.mocked(sendMessage).mockResolvedValue(999 as any);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00', telegram_message_id: 111 }, error: null }, // differenza ~16.7%
      { data: null, error: null }, // delete
      { data: { id: 44 }, error: null }, // insert nuova proposta
      { data: null, error: null }, // update telegram_message_id
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('15.00'),
      expect.anything()
    );
  });

  it('elimina la vecchia proposta pending obsoleta se il valore proposto è cambiato', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ proposedValue: '15.00' })]);
    vi.mocked(sendMessage).mockResolvedValue(999 as any);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00', telegram_message_id: 111 }, error: null }, // pending con valore diverso
      { data: null, error: null }, // esito della delete
      { data: { id: 43 }, error: null }, // insert della nuova proposta
      { data: null, error: null }, // update telegram_message_id
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('15.00'),
      expect.objectContaining({
        inline_keyboard: [
          [
            { text: '✅ Approva', callback_data: 'proposal:43:approve' },
            { text: '❌ Rifiuta', callback_data: 'proposal:43:reject' },
          ],
        ],
      })
    );
  });
});

describe('expireStalePendingProposals', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('non fa nulla se non ci sono proposte pending scadute', async () => {
    const supabase = createFakeSupabase([{ data: [], error: null }]);

    const count = await expireStalePendingProposals(supabase);

    expect(count).toBe(0);
  });

  it('marca come rejected le proposte pending più vecchie di 14 giorni e logga il risultato', async () => {
    const supabase = createFakeSupabase([
      { data: [{ id: 1 }, { id: 2 }], error: null }, // select delle stale
      { data: null, error: null }, // update -> rejected
    ]);

    const count = await expireStalePendingProposals(supabase);

    expect(count).toBe(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 proposte pending scadute'));
  });

  it('ritorna 0 e logga un errore se l\'update fallisce', async () => {
    const supabase = createFakeSupabase([
      { data: [{ id: 1 }], error: null }, // select delle stale
      { data: null, error: { message: 'db error' } }, // update fallito
    ]);

    const count = await expireStalePendingProposals(supabase);

    expect(count).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});
