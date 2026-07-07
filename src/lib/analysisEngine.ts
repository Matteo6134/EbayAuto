import { getMarketInsights } from './marketAnalysis';

export interface MetricPoint {
  metricDate: string;
  watchCount: number;
  quantitySold: number;
  revenue: number;
  price: number;
  adRatePercent: number | null;
  // From Analytics API
  impressionCount: number | null;
  clickCount: number | null;
  clickThroughRate: number | null; // 0-100%
}

export interface ListingSnapshot {
  listingId: number;
  ebayItemId: string;
  title: string;
  categoryId: string | null;
  today: MetricPoint;
  history: MetricPoint[];
}

export interface ProposalDraft {
  field: 'title' | 'price' | 'category' | 'ad_rate' | 'offer' | 'relist' | 'social_boost' | 'seo_fix';
  currentValue: string;
  proposedValue: string; // for JSON payload if needed
  rationale: string;
  impact: 'normal' | 'high';
  actionable: boolean;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function analyzeListing(snapshot: ListingSnapshot, accessToken: string): Promise<ProposalDraft[]> {
  const proposals: ProposalDraft[] = [];
  const avgWatch = average(snapshot.history.map((h) => h.watchCount));
  const recentSales = snapshot.history.reduce((sum, h) => sum + h.quantitySold, 0) + snapshot.today.quantitySold;
  const hasEnoughHistory = snapshot.history.length >= 3;
  const isCompletelyDead = hasEnoughHistory && recentSales === 0 && snapshot.today.watchCount === 0 && (snapshot.today.impressionCount ?? 0) === 0;

  // --- Ghost Check: verify listing is actually indexed by eBay Cassini ---
  if (isCompletelyDead) {
    try {
      const { checkListingIndexed } = await import('./ebayLazarus');
      const ghostResult = await checkListingIndexed(accessToken, snapshot.title);
      if (!ghostResult.isIndexed) {
        proposals.push({
          field: 'relist',
          currentValue: snapshot.ebayItemId,
          proposedValue: snapshot.ebayItemId,
          rationale: `☠️ SHADOW BAN RILEVATO: Una ricerca sul tuo titolo esatto restituisce 0 risultati su eBay. L'inserzione non è indicizzata da Cassini — modificarla non serve a nulla. Attivare il Modulo Lazarus per ricominciare da zero con un nuovo ID!`,
          impact: 'high',
          actionable: true,
        });
        return proposals; // Stop here, no point analyzing a ghost listing
      }
    } catch (ghostErr) {
      console.warn('Ghost check failed, proceeding normally:', ghostErr);
    }
  }

  // --- Lazarus: relist if dead for 30+ days with no impressions ---
  if (isCompletelyDead && snapshot.history.length >= 30) {
    proposals.push({
      field: 'relist',
      currentValue: snapshot.ebayItemId,
      proposedValue: snapshot.ebayItemId,
      rationale: `💀 Inserzione clinicamente morta: ${snapshot.history.length} giorni con 0 osservatori, 0 vendite, 0 impressioni. L'algoritmo Cassini l'ha penalizzata permanentemente. Attivo il Modulo Lazarus: chiudo il vecchio annuncio e lo riapro come nuovo per ottenere il badge "Appena messo in vendita" e la spinta di visibilità iniziale!`,
      impact: 'high',
      actionable: true,
    });
    return proposals; // Lazarus supersedes all other proposals
  }

  const insights = await getMarketInsights(accessToken, snapshot.title, snapshot.categoryId);
  if (insights.averagePrice !== null) {
    const highThreshold = insights.averagePrice * 1.05;
    const lowThreshold = insights.averagePrice * 0.85;

    if (snapshot.today.price > highThreshold) {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: insights.averagePrice.toFixed(2),
        rationale: `Il mercato vende oggetti simili a una media di ${insights.averagePrice.toFixed(2)}€. Il tuo prezzo (${snapshot.today.price.toFixed(2)}€) è fuori mercato. Allinealo per sbloccare le vendite!`,
        impact: 'high',
        actionable: true,
      });
    } else if (snapshot.today.price < lowThreshold) {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: (insights.averagePrice * 0.95).toFixed(2),
        rationale: `Il tuo prezzo (${snapshot.today.price.toFixed(2)}€) è molto inferiore alla media di mercato (${insights.averagePrice.toFixed(2)}€). Puoi permetterti di alzarlo e guadagnare di più!`,
        impact: 'high',
        actionable: true,
      });
    } else {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: snapshot.today.price.toFixed(2),
        rationale: `Il tuo prezzo è perfettamente in linea con la media di mercato attuale (${insights.averagePrice.toFixed(2)}€). Nessuna modifica necessaria.`,
        impact: 'normal',
        actionable: false,
      });
    }
  }

  const noInterestAtAll = snapshot.today.watchCount === 0;

  if (noInterestAtAll && recentSales === 0) {
    if (insights.suggestedCategoryId && insights.suggestedCategoryId !== snapshot.categoryId) {
      const catLabel = insights.suggestedCategoryName
        ? `"${insights.suggestedCategoryName}" (ID: ${insights.suggestedCategoryId})`
        : `ID: ${insights.suggestedCategoryId}`;
      proposals.push({
        field: 'category',
        currentValue: snapshot.categoryId ?? 'sconosciuta',
        proposedValue: insights.suggestedCategoryId,
        rationale: `Nessun interesse riscontrato. L'IA di eBay suggerisce la categoria ${catLabel} come la più adatta per questo prodotto. Il cambio verrà applicato automaticamente con le specifiche obbligatorie!`,
        impact: 'high',
        actionable: true,
      });
    } else {
      proposals.push({
        field: 'category',
        currentValue: snapshot.categoryId ?? 'sconosciuta',
        proposedValue: 'rivedi manualmente',
        rationale: `Nessun interesse (0 osservatori oggi) e nessuna vendita. Anche il motore eBay non ha una categoria chiara per questo prodotto: prova a modificare il titolo con parole più precise.`,
        impact: 'high',
        actionable: false,
      });
    }
  }

  const visibilityDropped = (avgWatch > 0 && snapshot.today.watchCount < avgWatch * 0.7) || (snapshot.today.watchCount === 0 && avgWatch === 0);
  
  if (visibilityDropped) {
    if (snapshot.today.adRatePercent != null) {
      const proposedRate = Math.min(snapshot.today.adRatePercent + 2, 20);
      proposals.push({
        field: 'ad_rate',
        currentValue: `${snapshot.today.adRatePercent}%`,
        proposedValue: `${proposedRate}%`,
        rationale: `Scarso interesse: oggi ${snapshot.today.watchCount} osservatori. Un piccolo boost alle ads può aiutare l'algoritmo di eBay.`,
        impact: 'normal',
        actionable: true,
      });
    } else if (insights.suggestedTitle) {
      proposals.push({
        field: 'title',
        currentValue: snapshot.title,
        proposedValue: insights.suggestedTitle,
        rationale: `Attenzione scarsa o in calo. Ho generato un nuovo titolo mixando le keyword esatte usate dai concorrenti più popolari per spingere la SEO al massimo!`,
        impact: 'high',
        actionable: true,
      });
    } else {
      proposals.push({
        field: 'title',
        currentValue: snapshot.title,
        proposedValue: 'aggiungi keyword popolari o dettagli tecnici',
        rationale: `Attenzione scarsa o in calo (oggi ${snapshot.today.watchCount} osservatori). Rivedi il titolo per migliorare la SEO su eBay.`,
        impact: 'normal',
        actionable: false,
      });
    }
  }

  // --- SEO Doctor ---
  // If views are very low or 0, check for missing item specifics
  if (snapshot.today.watchCount === 0 || visibilityDropped) {
    if (snapshot.categoryId) {
      try {
        const { analyzeSeoSpecifics } = await import('./ebaySeoDoctor');
        const seoResult = await analyzeSeoSpecifics(accessToken, snapshot.ebayItemId, snapshot.categoryId);
        if (seoResult && seoResult.missingRequired.length > 0) {
          proposals.push({
            field: 'seo_fix',
            currentValue: `${seoResult.currentAspectsCount} compilate`,
            proposedValue: `Aggiungi ${seoResult.missingRequired.length} obbligatorie`,
            rationale: `⚠️ Ti mancano le seguenti specifiche OBBLIGATORIE: ${seoResult.missingRequired.join(', ')}. eBay nasconde le inserzioni senza questi campi dai filtri di ricerca!`,
            impact: 'high',
            actionable: false, // For now manual action required
          });
        }
      } catch (e) {
        console.warn('SEO Doctor failed:', e);
      }
    }
  }

  // --- Social Booster ---
  // If there's some sales history but currently slow, or user has social enabled
  if (hasEnoughHistory && recentSales === 0) {
    try {
      const { generateSocialPost } = await import('./ebaySocial');
      const post = generateSocialPost(snapshot.title, snapshot.today.price, snapshot.categoryId, snapshot.ebayItemId, []);
      proposals.push({
        field: 'social_boost',
        currentValue: 'Traffico solo da eBay',
        proposedValue: 'Genera Post Social (Facebook/IG)',
        rationale: `Le visualizzazioni organiche sono ferme. Condividi questo annuncio sui Social per portare traffico esterno (eBay Cassini premia molto chi porta traffico da fuori!).`,
        impact: 'normal',
        actionable: true,
      });
    } catch (e) {
      console.warn('Social Booster failed:', e);
    }
  }

  // --- CTR Analysis (Analytics API data) ---
  const ctr = snapshot.today.clickThroughRate;
  const impressions = snapshot.today.impressionCount ?? 0;

  if (impressions >= 100 && ctr !== null) {
    if (ctr < 0.5) {
      // Very low CTR: the listing is being shown but nobody clicks → title/photo problem
      const ctrLabel = ctr.toFixed(2);
      if (insights.suggestedTitle && insights.suggestedTitle !== snapshot.title) {
        proposals.push({
          field: 'title',
          currentValue: snapshot.title,
          proposedValue: insights.suggestedTitle,
          rationale: `CTR critico: solo ${ctrLabel}% su ${impressions.toLocaleString()} impressioni. eBay ti mostra ma nessuno clicca → il titolo è il problema. Titolo SEO generato dai top seller applicato automaticamente!`,
          impact: 'high',
          actionable: true,
        });
      } else {
        proposals.push({
          field: 'title',
          currentValue: snapshot.title,
          proposedValue: 'Aggiungi dettagli specifici: modello, colore, materiale, dimensioni',
          rationale: `CTR basso: ${ctrLabel}% su ${impressions.toLocaleString()} impressioni. Gli acquirenti ti vedono ma non cliccano. Aggiungi caratteristiche specifiche al titolo.`,
          impact: 'high',
          actionable: false,
        });
      }
    } else if (ctr >= 2.0 && recentSales === 0 && snapshot.today.watchCount >= 3) {
      // High CTR, people visit but don't buy → price might be the issue
      // Also eligible for watcher offer
    }
  }

  // --- Watcher Offer via Negotiation API ---
  // If item has watchers but no sales for multiple days, send a private discount offer
  if (
    hasEnoughHistory &&
    snapshot.today.watchCount >= 3 &&
    recentSales === 0 &&
    !proposals.some((p) => p.field === 'offer')
  ) {
    proposals.push({
      field: 'offer',
      currentValue: `${snapshot.today.watchCount} osservatori, 0 vendite`,
      proposedValue: JSON.stringify({
        discount: 5,
        ebayItemId: snapshot.ebayItemId,
        currentPrice: snapshot.today.price,
      }),
      rationale: `🎯 Hai ${snapshot.today.watchCount} persone che osservano senza comprare da ${snapshot.history.length}+ giorni. Invia loro un'offerta privata sconto 5% valida 48h — chiudi la vendita adesso!`,
      impact: 'high',
      actionable: true,
    });
  }

  // --- Classica logica prezzo con storico ---
  if (hasEnoughHistory && snapshot.today.watchCount >= 3 && recentSales === 0) {
    const discountedPrice = Math.round(snapshot.today.price * 0.9 * 100) / 100;
    if (!proposals.some((p) => p.field === 'price') && !proposals.some((p) => p.field === 'offer')) {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: discountedPrice.toFixed(2),
        rationale: `Interesse presente (${snapshot.today.watchCount} osservatori) ma nessuna vendita da almeno ${snapshot.history.length} giorni: sconto del 10% consigliato.`,
        impact: 'normal',
        actionable: true,
      });
    }
  }

  const yesterday = snapshot.history[snapshot.history.length - 1];
  if (
    snapshot.today.adRatePercent != null &&
    yesterday?.adRatePercent != null &&
    snapshot.today.adRatePercent > yesterday.adRatePercent &&
    !visibilityDropped
  ) {
    proposals.push({
      field: 'ad_rate',
      currentValue: `${snapshot.today.adRatePercent}%`,
      proposedValue: `${Math.max(snapshot.today.adRatePercent - 2, 0)}%`,
      rationale: 'La % ads è stata aumentata di recente ma gli osservatori non sono aumentati in proporzione: valuta di ridurla.',
      impact: 'normal',
      actionable: true,
    });
  }

  return proposals;
}
