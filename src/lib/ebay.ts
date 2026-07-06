export interface EbayListingSummary {
  itemId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  price: number;
  currency: string;
}

export function extractItemId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{9,15}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/);
  return match ? match[1] : null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAppAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('EBAY_CLIENT_ID o EBAY_CLIENT_SECRET mancanti');
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) {
    throw new Error(`Impossibile ottenere il token eBay (status ${res.status})`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

export async function fetchListingSummary(itemId: string): Promise<EbayListingSummary> {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${itemId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT',
      },
    }
  );
  if (!res.ok) {
    throw new Error(`eBay non ha trovato l'inserzione ${itemId} (status ${res.status})`);
  }
  const data = await res.json();
  return {
    itemId,
    title: data.title,
    categoryId: data.categoryId,
    categoryName: data.categoryPath ?? data.categoryId,
    price: Number(data.price?.value ?? 0),
    currency: data.price?.currency ?? 'EUR',
  };
}
