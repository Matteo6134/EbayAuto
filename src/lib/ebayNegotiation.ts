export interface SendOfferResult {
  success: boolean;
  offerId?: string;
  error?: string;
}

/**
 * Sends a private discount offer to all interested buyers (watchers) of a listing.
 * Uses the eBay Negotiation API - the same mechanism eBay uses for "Make Offer" deals.
 *
 * Docs: https://developer.ebay.com/api-docs/sell/negotiation/resources/offer/methods/sendOfferToInterestedBuyers
 *
 * Note: Requires the listing to have "Best Offer" enabled, OR eBay may still allow
 * sending offers to watchers even without it in certain categories.
 */
export async function sendOfferToWatchers(
  accessToken: string,
  ebayItemId: string,
  currentPrice: number,
  discountPercent: number // e.g. 5 = 5% off
): Promise<SendOfferResult> {
  const offeredPrice = Math.round(currentPrice * (1 - discountPercent / 100) * 100) / 100;

  // Offer expires in 48 hours
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);

  const body = {
    allowCounteroffer: false,
    message: `Offerta speciale disponibile per 48 ore! Approfitta subito di questo sconto esclusivo.`,
    offerDuration: {
      unit: 'HOUR',
      value: 48,
    },
    offeredItems: [
      {
        listingId: ebayItemId,
        price: {
          currency: 'EUR',
          value: offeredPrice.toFixed(2),
        },
        quantity: 1,
      },
    ],
  };

  const res = await fetch(
    'https://api.ebay.com/sell/negotiation/v1/send_offer_to_interested_buyers',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg =
      errBody?.errors?.[0]?.longMessage ||
      errBody?.errors?.[0]?.message ||
      `HTTP ${res.status}`;
    return { success: false, error: errMsg };
  }

  const data = await res.json();
  return {
    success: true,
    offerId: data.offerId ?? data.offers?.[0]?.offerId,
  };
}

/**
 * Checks if a listing is eligible to receive offers (has interested buyers).
 * Returns the number of interested buyers, or null if the API fails.
 */
export async function getInterestedBuyersCount(
  accessToken: string,
  ebayItemId: string
): Promise<number | null> {
  const res = await fetch(
    `https://api.ebay.com/sell/negotiation/v1/find_eligible_items?listing_ids=${ebayItemId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT',
      },
    }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const item = (data.eligibleItems ?? []).find(
    (i: any) => String(i.listingId) === String(ebayItemId)
  );
  return item?.interestedBuyersCount ?? null;
}
