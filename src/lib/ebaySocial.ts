export interface SocialPostData {
  text: string;
  photoUrl: string | null;
}

/**
 * Social Booster Module
 * Generates a ready-to-share social media post for Facebook/Instagram
 * with optimized hashtags and a tracked affiliate link (if configured)
 * to bring external traffic to an eBay listing.
 */
export function generateSocialPost(
  title: string,
  price: number,
  categoryName: string | null,
  ebayItemId: string,
  photoUrls: string[]
): SocialPostData {
  // Extract keywords for hashtags
  const words = title
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}`);

  if (categoryName) {
    const catWords = categoryName
      .split(/[\s>]+/)
      .filter((w) => w.length > 3)
      .slice(0, 2)
      .map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}`);
    words.push(...catWords);
  }

  // Deduplicate and take top 5 hashtags
  const hashtags = Array.from(new Set(words)).slice(0, 5).join(' ');

  // Generate tracked link
  // Use eBay Partner Network format or simple ebay.it link
  // For EPN, normally you'd use your campaign ID. Here we use a generic tracked format.
  const campaignId = process.env.EBAY_EPN_CAMPAIGN_ID ?? '5339023407'; // placeholder/fallback EPN campaign
  // A modern EPN link format for IT marketplace:
  const trackedLink = `https://www.ebay.it/itm/${ebayItemId}?mkevt=1&mkcid=1&mkrid=724-53478-19255-0&campid=${campaignId}&toolid=20006&customid=socialbooster`;

  const text = `🔥 ${title}\n\n💶 Solo ${price.toFixed(2)}€\n\n👉 Scopri di più su eBay: ${trackedLink}\n\n${hashtags}`;

  return {
    text,
    photoUrl: photoUrls.length > 0 ? photoUrls[0] : null,
  };
}
