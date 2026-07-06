import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('buildAuthorizeUrl', () => {
  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = 'client-id';
    process.env.EBAY_CLIENT_SECRET = 'client-secret';
    process.env.EBAY_RUNAME = 'My-RuName-123';
    vi.resetModules();
  });

  it('costruisce l\'URL di autorizzazione con i parametri corretti', async () => {
    const { buildAuthorizeUrl } = await import('@/lib/ebayOAuth');
    const url = buildAuthorizeUrl('state-abc');
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe('https://auth.ebay.com/oauth2/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe('My-RuName-123');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('scope')).toContain('sell.inventory');
  });

  it('lancia un errore se mancano le variabili di configurazione', async () => {
    delete process.env.EBAY_RUNAME;
    const { buildAuthorizeUrl } = await import('@/lib/ebayOAuth');
    expect(() => buildAuthorizeUrl('state-abc')).toThrow(
      'EBAY_CLIENT_ID, EBAY_CLIENT_SECRET o EBAY_RUNAME mancanti'
    );
  });
});

describe('exchangeCodeForTokens / refreshAccessToken', () => {
  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = 'client-id';
    process.env.EBAY_CLIENT_SECRET = 'client-secret';
    process.env.EBAY_RUNAME = 'My-RuName-123';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scambia il code per i token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-123',
        refresh_token: 'refresh-123',
        expires_in: 7200,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { exchangeCodeForTokens } = await import('@/lib/ebayOAuth');
    const tokens = await exchangeCodeForTokens('auth-code-xyz');

    expect(tokens.accessToken).toBe('access-123');
    expect(tokens.refreshToken).toBe('refresh-123');
    expect(new Date(tokens.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain('grant_type=authorization_code');
    expect(options.body).toContain('code=auth-code-xyz');
    expect(options.body).toContain('redirect_uri=My-RuName-123');
  });

  it('lancia un errore se lo scambio del code fallisce', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { exchangeCodeForTokens } = await import('@/lib/ebayOAuth');
    await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow(
      'Scambio token eBay fallito (status 400)'
    );
  });

  it('rinnova il token mantenendo lo stesso refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-access-456',
        expires_in: 7200,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { refreshAccessToken } = await import('@/lib/ebayOAuth');
    const tokens = await refreshAccessToken('existing-refresh-token');

    expect(tokens.accessToken).toBe('new-access-456');
    expect(tokens.refreshToken).toBe('existing-refresh-token');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain('grant_type=refresh_token');
    expect(options.body).toContain('refresh_token=existing-refresh-token');
  });
});
