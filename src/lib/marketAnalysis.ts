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
  suggestedTitle: string | null;
}

export async function getMarketInsights(accessToken: string, title: string, categoryId: string | null): Promise<MarketInsights> {
  const query = extractKeywords(title);
  const defaultInsights: MarketInsights = { averagePrice: null, suggestedCategoryId: null, suggestedTitle: null };
  if (!query) return defaultInsights;

  let url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=50`;
  // Rimuoviamo il filtro per category_ids per poter capire in quali categorie postano i competitor
  // se usiamo sempre la nostra potremmo non scoprire mai se è sbagliata!

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT', 
      'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=<ePNCampaignId>,affiliateReferenceId=<referenceId>'
    }
  });

  if (!res.ok) {
    console.error(`Ricerca mercato eBay fallita: ${res.status}`);
    return defaultInsights;
  }

  const data = await res.json();
  if (!data.itemSummaries || data.itemSummaries.length === 0) {
    return defaultInsights;
  }

  let total = 0;
  let count = 0;
  const categoryCounts: Record<string, number> = {};
  const wordCounts: Record<string, number> = {};

  for (const item of data.itemSummaries) {
    // Media Prezzi
    const priceStr = item.price?.value;
    if (priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        total += price;
        count++;
      }
    }

    // Identificazione Categorie
    const cats = item.categories;
    if (cats && cats.length > 0) {
      const mainCat = cats[0].categoryId;
      categoryCounts[mainCat] = (categoryCounts[mainCat] || 0) + 1;
    }
  }

  // Calcolo Prezzo Medio
  const averagePrice = count > 0 ? Math.round((total / count) * 100) / 100 : null;

  // Calcolo Categoria Suggerita (quella più frequente)
  let bestCategory: string | null = null;
  let maxCatCount = 0;
  for (const cat in categoryCounts) {
    if (categoryCounts[cat] > maxCatCount) {
      maxCatCount = categoryCounts[cat];
      bestCategory = cat;
    }
  }

  // Estrazione Keyword (Titolo) filtrata solo sugli oggetti della categoria vincente
  for (const item of data.itemSummaries) {
    const cats = item.categories;
    if (bestCategory && cats && cats.length > 0 && cats[0].categoryId !== bestCategory) {
      continue; // Ignora oggetti di altre categorie per la SEO
    }
    if (item.title) {
      const itemWords = item.title.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w: string) => w.length > 2);
      for (const w of itemWords) {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      }
    }
  }

  // Generazione Titolo (Unione delle 10-12 keyword più usate)
  let suggestedTitle: string | null = null;
  const sortedWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  if (sortedWords.length > 0) {
    let newTitle = '';
    for (const w of sortedWords) {
      if ((newTitle.length + w.length + 1) > 80) break;
      newTitle += (newTitle ? ' ' : '') + w;
    }
    // Capitalize first letters for better visual
    suggestedTitle = newTitle.replace(/\b\w/g, l => l.toUpperCase());
  }

  return {
    averagePrice,
    suggestedCategoryId: bestCategory,
    suggestedTitle
  };
}
