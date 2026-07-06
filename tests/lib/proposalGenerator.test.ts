import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';

vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { sendMessage } from '@/lib/telegram';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import type { ListingSnapshot, MetricPoint } from '@/lib/analysisEngine';

function metric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metricDate: '2026-07-01',
    watchCount: 10,
    quantitySold: 0,
    revenue: 0,
    price: 20,
    adRatePercent: null,
    ...overrides,
  };
}

describe('generateAndSendProposals', () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
  });

  it('non manda nulla se il motore non genera proposte', async () => {
    const snapshot: ListingSnapshot = {
      listingId: 1,
      title: 'Prodotto Test',
      categoryId: '1',
      today: metric(),
      history: [],
    };
    const supabase = createFakeSupabase([]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot);

    expect(result).toEqual({ sent: 0, informational: [] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come informational e non manda bottoni per una proposta non azionabile', async () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const snapshot: ListingSnapshot = {
      listingId: 1,
      title: 'Prodotto Test',
      categoryId: '1',
      today: metric({ watchCount: 1, quantitySold: 0 }),
      history,
    };
    const supabase = createFakeSupabase([{ data: { id: 99 }, error: null }]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot);

    expect(result.sent).toBe(0);
    expect(result.informational).toHaveLength(1);
    expect(result.informational[0]).toContain('categoria');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come pending e manda un messaggio con bottoni per una proposta azionabile', async () => {
    const history = [
      metric({ watchCount: 8, quantitySold: 0 }),
      metric({ watchCount: 8, quantitySold: 0 }),
      metric({ watchCount: 8, quantitySold: 0 }),
    ];
    const snapshot: ListingSnapshot = {
      listingId: 1,
      title: 'Prodotto Test',
      categoryId: '1',
      today: metric({ watchCount: 8, quantitySold: 0, price: 20 }),
      history,
    };
    const supabase = createFakeSupabase([{ data: { id: 42 }, error: null }]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot);

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
});
