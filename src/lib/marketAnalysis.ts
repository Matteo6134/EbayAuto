export function extractKeywords(title: string): string {
  // Rimuove punteggiatura e converte in minuscolo
  let cleanTitle = title.toLowerCase().replace(/[^\w\s-]/g, ' ');
  // Divide in parole, ignorando singole lettere (come preposizioni deboli)
  let words = cleanTitle.split(/\s+/).filter(w => w.length > 1);
  // Prende le prime 5 parole più significative
  return words.slice(0, 5).join(' ');
}

export interface MarketInsights {
  averagePrice: number | null;
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  suggestedTitle: string | null;
  /** True when the sample of external comparables was too small (<3) to trust the average. */
  insufficientData: boolean;
  /** Number of external competitor listings used to compute averagePrice (0 when insufficient/unavailable). */
  competitorCount: number;
}

/** Minimum number of external competitor items required before trusting an average price. */
export const MIN_COMPARABLE_SAMPLE = 3;

/**
 * Returns true when a Browse API item result is the seller's own listing.
 * Browse API items expose `itemId` as `v1|<legacyItemId>|0` and also a plain
 * `legacyItemId` field; either one may match the watched listing's own eBay
 * item id.
 */
export function isOwnItem(item: { itemId?: string; legacyItemId?: string }, ownEbayItemId: string): boolean {
  if (!ownEbayItemId) return false;
  if (item.legacyItemId && item.legacyItemId === ownEbayItemId) return true;
  if (item.itemId && item.itemId.includes(ownEbayItemId)) return true;
  return false;
}

export async function getMarketInsights(
  accessToken: string,
  title: string,
  categoryId: string | null,
  ownEbayItemId: string
): Promise<MarketInsights> {
  const defaultInsights: MarketInsights = {
    averagePrice: null,
    suggestedCategoryId: null,
    suggestedCategoryName: null,
    suggestedTitle: null,
    insufficientData: true,
    competitorCount: 0,
  };

  const query = extractKeywords(title);
  if (!query) return defaultInsights;

  // --- Step 1: Find the correct category using eBay's own algorithm ---
  let bestCategoryId: string | null = categoryId; // use known category as base
  let bestCategoryName: string | null = null;

  try {
    const { getBestCategory } = await import('./ebaySuggestCategory');
    const suggestion = await getBestCategory(accessToken, title);
    if (suggestion && suggestion.percentItemFound >= 30) {
      // Only override if eBay is at least 30% confident
      bestCategoryId = suggestion.categoryId;
      bestCategoryName = `${suggestion.categoryParentName} > ${suggestion.categoryName}`;
    }
  } catch (suggestError) {
    console.warn('GetSuggestedCategories unavailable:', suggestError);
  }

  // --- Step 2: Search Browse API filtered by the confirmed/suggested category ---
  let url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=50`;
  if (bestCategoryId) {
    url += `&category_ids=${bestCategoryId}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT',
    },
  });

  if (!res.ok) {
    console.error(`Ricerca mercato eBay fallita: ${res.status}`);
    return { ...defaultInsights, suggestedCategoryId: bestCategoryId, suggestedCategoryName: bestCategoryName };
  }

  const data = await res.json();
  if (!data.itemSummaries || data.itemSummaries.length === 0) {
    return { ...defaultInsights, suggestedCategoryId: bestCategoryId, suggestedCategoryName: bestCategoryName };
  }

  // Exclude the seller's own item from the comparable set: otherwise the
  // near-exact-title query matches (or is dominated by) the seller's own
  // live listing and the "market average" degenerates to the own price.
  const competitorItems = data.itemSummaries.filter((item: any) => !isOwnItem(item, ownEbayItemId));

  // --- Step 3: Compute average price and extract SEO keywords ---
  let total = 0;
  let count = 0;
  const wordCounts: Record<string, number> = {};

  for (const item of competitorItems) {
    const priceStr = item.price?.value;
    if (priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price) && price > 0) {
        total += price;
        count++;
      }
    }

    // Extract SEO keywords from competitor titles
    if (item.title) {
      const itemWords = item.title
        .toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length > 2);
      for (const w of itemWords) {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      }
    }
  }

  // --- Step 4: Build optimized title from top keywords ---
  let suggestedTitle: string | null = null;
  const sortedWords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);

  if (sortedWords.length > 0) {
    let newTitle = '';
    for (const w of sortedWords) {
      if (newTitle.length + w.length + 1 > 80) break;
      newTitle += (newTitle ? ' ' : '') + w;
    }
    suggestedTitle = newTitle.replace(/\b\w/g, (l) => l.toUpperCase());
  }

  // Require a minimum sample of external comparables before trusting the
  // average; otherwise signal "insufficient market data" instead of a
  // fake/unreliable average.
  if (count < MIN_COMPARABLE_SAMPLE) {
    return {
      averagePrice: null,
      suggestedCategoryId: bestCategoryId,
      suggestedCategoryName: bestCategoryName,
      suggestedTitle,
      insufficientData: true,
      competitorCount: count,
    };
  }

  const averagePrice = Math.round((total / count) * 100) / 100;

  return {
    averagePrice,
    suggestedCategoryId: bestCategoryId,
    suggestedCategoryName: bestCategoryName,
    suggestedTitle,
    insufficientData: false,
    competitorCount: count,
  };
}
