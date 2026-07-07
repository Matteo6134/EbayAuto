const OAUTH_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
].join(' ');

export interface EbayTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

function getOAuthConfig() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  if (!clientId || !clientSecret || !ruName) {
    throw new Error('EBAY_CLIENT_ID, EBAY_CLIENT_SECRET o EBAY_RUNAME mancanti');
  }
  return { clientId, clientSecret, ruName };
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, ruName } = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: ruName,
    scope: OAUTH_SCOPES,
    state,
    prompt: 'login',
  });
  return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`;
}

async function requestToken(body: string): Promise<EbayTokens & { refreshToken: string }> {
  const { clientId, clientSecret } = getOAuthConfig();
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    let errorText = '';
    try {
      errorText = await res.text();
    } catch (e) {
      errorText = 'Impossibile leggere i dettagli dell\'errore.';
    }
    throw new Error(`Scambio token eBay fallito (status ${res.status}): ${errorText}`);
  }
  const data = await res.json();
  const accessTokenExpiresAt = new Date(Date.now() + (data.expires_in - 60) * 1000).toISOString();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt,
  };
}

export async function exchangeCodeForTokens(code: string): Promise<EbayTokens> {
  const { ruName } = getOAuthConfig();
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: ruName,
  });
  return requestToken(params.toString());
}

export async function refreshAccessToken(refreshToken: string): Promise<EbayTokens> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: OAUTH_SCOPES,
  });
  const tokens = await requestToken(params.toString());
  return { ...tokens, refreshToken };
}
