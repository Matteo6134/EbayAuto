import { XMLParser } from 'fast-xml-parser';

export interface SuggestedCategory {
  categoryId: string;
  categoryName: string;
  categoryParentName: string;
  percentItemFound: number; // eBay confidence score
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Uses eBay's own GetSuggestedCategories API (the same one eBay uses when
 * a seller lists a new item) to find the best-fit category for a product title.
 * Returns results ordered by eBay's confidence score (PercentItemFound).
 */
export async function getSuggestedCategories(
  accessToken: string,
  title: string
): Promise<SuggestedCategory[]> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetSuggestedCategoriesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Query>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Query>
</GetSuggestedCategoriesRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101', // Italy
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'GetSuggestedCategories',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: xmlBody,
  });

  if (!res.ok) {
    console.error(`GetSuggestedCategories failed: HTTP ${res.status}`);
    return [];
  }

  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const ack = parsed?.GetSuggestedCategoriesResponse?.Ack;

  if (ack !== 'Success' && ack !== 'Warning') {
    const errors = parsed?.GetSuggestedCategoriesResponse?.Errors;
    const msg = Array.isArray(errors)
      ? errors.map((e: any) => e.LongMessage || e.ShortMessage).join(' | ')
      : errors?.LongMessage || 'Unknown error';
    console.error(`GetSuggestedCategories error: ${msg}`);
    return [];
  }

  const rawList = toArray(
    parsed?.GetSuggestedCategoriesResponse?.SuggestedCategoryArray?.SuggestedCategory
  );

  return rawList
    .map((item: any) => ({
      categoryId: String(item.Category?.CategoryID ?? ''),
      categoryName: String(item.Category?.CategoryName ?? ''),
      categoryParentName: String(item.Category?.CategoryParentName ?? ''),
      percentItemFound: Number(item.PercentItemFound ?? 0),
    }))
    .filter((c) => c.categoryId && c.percentItemFound > 0)
    .sort((a, b) => b.percentItemFound - a.percentItemFound);
}

/**
 * Returns the single best-fit category (highest confidence) for a given title.
 */
export async function getBestCategory(
  accessToken: string,
  title: string
): Promise<SuggestedCategory | null> {
  const suggestions = await getSuggestedCategories(accessToken, title);
  return suggestions[0] ?? null;
}
