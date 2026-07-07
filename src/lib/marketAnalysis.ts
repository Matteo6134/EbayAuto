export function extractKeywords(title: string): string {
  // Rimuove punteggiatura e converte in minuscolo
  let cleanTitle = title.toLowerCase().replace(/[^\w\s-]/g, ' ');
  // Divide in parole, ignorando singole lettere (come preposizioni deboli)
  let words = cleanTitle.split(/\s+/).filter(w => w.length > 1);
  // Prende le prime 5 parole più significative
  return words.slice(0, 5).join(' ');
}

export async function getMarketAveragePrice(accessToken: string, title: string, categoryId: string | null): Promise<number | null> {
  const query = extractKeywords(title);
  if (!query) return null;

  let url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=50`;
  if (categoryId) {
    url += `&category_ids=${categoryId}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT', // Assumiamo mercato italiano per ora
      'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>' // non strettamente necessario ma buona pratica
    }
  });

  if (!res.ok) {
    console.error(`Ricerca mercato eBay fallita: ${res.status}`);
    return null;
  }

  const data = await res.json();
  if (!data.itemSummaries || data.itemSummaries.length === 0) {
    return null;
  }

  let total = 0;
  let count = 0;

  for (const item of data.itemSummaries) {
    const priceStr = item.price?.value;
    if (priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        total += price;
        count++;
      }
    }
  }

  if (count === 0) return null;
  return Math.round((total / count) * 100) / 100;
}
