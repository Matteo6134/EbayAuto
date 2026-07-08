import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    // Nei test eseguiamo subito il callback di `after` così possiamo
    // verificare la chiamata al cron endpoint.
    after: vi.fn((callback: () => Promise<void>) => callback()),
  };
});

import { handleAnalyze } from '@/lib/commands/analyze';

describe('handleAnalyze', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.vercel.app';
    process.env.CRON_SECRET = 'cron-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('segnala la configurazione mancante se manca CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    const supabase = createFakeSupabase([]);
    const result = await handleAnalyze({ supabase, chatId: 100, args: '' });
    expect(result.text).toContain('Configurazione mancante');
  });

  it('risponde subito e invoca il cron endpoint con il secret in background', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const supabase = createFakeSupabase([]);

    const result = await handleAnalyze({ supabase, chatId: 100, args: '' });

    expect(result.text).toContain('Analisi avviata');
    expect(fetchMock).toHaveBeenCalledWith('https://example.vercel.app/api/cron/daily-analysis', {
      headers: { Authorization: 'Bearer cron-secret' },
    });
  });

  it('non lancia se la chiamata al cron fallisce (logga soltanto)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rete giù')));
    const supabase = createFakeSupabase([]);

    const result = await handleAnalyze({ supabase, chatId: 100, args: '' });

    expect(result.text).toContain('Analisi avviata');
    expect(errorSpy).toHaveBeenCalled();
  });
});
