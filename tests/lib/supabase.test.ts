import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('getSupabaseClient', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('lancia un errore se mancano le variabili d\'ambiente', async () => {
    const { getSupabaseClient } = await import('@/lib/supabase');
    expect(() => getSupabaseClient()).toThrow('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti');
  });

  it('crea un client quando le variabili sono presenti', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const { getSupabaseClient } = await import('@/lib/supabase');
    const client = getSupabaseClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
});
