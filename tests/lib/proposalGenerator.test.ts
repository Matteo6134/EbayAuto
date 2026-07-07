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
import { generateAndSendProposals } from '@/lib/proposalGenerator';

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

  it('salva come informational e non manda bottoni per una proposta non azionabile', async () => {
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
    const supabase = createFakeSupabase([]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(0);
    expect(result.informational).toHaveLength(1);
    expect(result.informational[0]).toContain('categoria');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come pending e manda un messaggio con bottoni per una proposta azionabile', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft()]);
    const supabase = createFakeSupabase([
      { data: null, error: null }, // nessuna proposta pending esistente
      { data: { id: 42 }, error: null }, // insert riuscito
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

  it('salta inserimento e messaggio se esiste già una proposta pending con lo stesso valore', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ proposedValue: '18.00' })]);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00' }, error: null }, // pending identica già presente
    ]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot(), FAKE_TOKEN);

    expect(result.sent).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('elimina la vecchia proposta pending obsoleta se il valore proposto è cambiato', async () => {
    vi.mocked(analyzeListing).mockResolvedValue([draft({ proposedValue: '15.00' })]);
    const supabase = createFakeSupabase([
      { data: { id: 7, proposed_value: '18.00' }, error: null }, // pending con valore diverso
      { data: null, error: null }, // esito della delete
      { data: { id: 43 }, error: null }, // insert della nuova proposta
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
