import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';
import { routeCommand, isAuthorized } from '@/lib/commandRouter';

describe('commandRouter', () => {
  const originalOwner = process.env.TELEGRAM_OWNER_CHAT_ID;

  beforeEach(() => {
    process.env.TELEGRAM_OWNER_CHAT_ID = '100';
  });

  afterEach(() => {
    process.env.TELEGRAM_OWNER_CHAT_ID = originalOwner;
  });

  it('isAuthorized riconosce solo il chat_id proprietario', () => {
    expect(isAuthorized(100)).toBe(true);
    expect(isAuthorized(200)).toBe(false);
  });

  it('rifiuta i comandi da chat non autorizzate', async () => {
    const supabase = createFakeSupabase([]);
    const result = await routeCommand(supabase, 200, '/listproducts');
    expect(result.text).toContain('Non sei autorizzato');
  });

  it('risponde con un messaggio di aiuto per comandi sconosciuti', async () => {
    const supabase = createFakeSupabase([]);
    const result = await routeCommand(supabase, 100, '/pippo');
    expect(result.text).toContain('Comando non riconosciuto');
  });

  it('dispatcha /listproducts al comando corretto', async () => {
    const supabase = createFakeSupabase([{ data: [], error: null }]);
    const result = await routeCommand(supabase, 100, '/listproducts');
    expect(result.text).toContain('Nessun prodotto monitorato');
  });

  it('risponde a /help con la lista dei comandi', async () => {
    const supabase = createFakeSupabase([]);
    const result = await routeCommand(supabase, 100, '/help');
    expect(result.text).toContain('/addproduct');
    expect(result.text).toContain('/listproducts');
    expect(result.text).toContain('/connectebay');
    expect(result.text).toContain('/scanproducts');
    expect(result.text).toContain('/recap');
  });

  it('dispatcha /scanproducts al comando corretto', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await routeCommand(supabase, 100, '/scanproducts');
    expect(result.text).toContain('Nessun account eBay collegato');
  });

  it('dispatcha /recap al comando corretto', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await routeCommand(supabase, 100, '/recap 5');
    expect(result.text).toContain('Nessun prodotto trovato con id 5');
  });
});
