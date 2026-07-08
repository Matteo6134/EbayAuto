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

/** Never propose a price change bigger than this fraction of the current price in one step. */
const MAX_PRICE_STEP_FRACTION = 0.3;

/** Clamps a proposed price so it never moves more than ±30% away from the current price in one step. */
function clampPriceStep(currentPrice: number, proposedPrice: number): number {
  const minAllowed = currentPrice * (1 - MAX_PRICE_STEP_FRACTION);
  const maxAllowed = currentPrice * (1 + MAX_PRICE_STEP_FRACTION);
  return Math.min(Math.max(proposedPrice, minAllowed), maxAllowed);
}

/** Minimum impressions (30-day cumulative, from Analytics) before CTR-based rules are trusted. */
const MIN_IMPRESSIONS_FOR_CTR_RULES = 50;
/** Below this CTR (%) with enough impressions, the listing is shown but nobody clicks: title/photo problem. */
const LOW_CTR_THRESHOLD = 1.5;
/** At/above this CTR (%) with enough impressions, buyers are clicking through but not converting. */
const HIGH_CTR_THRESHOLD = 2.0;

export async function analyzeListing(snapshot: ListingSnapshot, accessToken: string): Promise<ProposalDraft[]> {
  const proposals: ProposalDraft[] = [];
  const avgWatch = average(snapshot.history.map((h) => h.watchCount));
  const recentSales = snapshot.history.reduce((sum, h) => sum + h.quantitySold, 0) + snapshot.today.quantitySold;
  const hasEnoughHistory = snapshot.history.length >= 3;
  // The Ghost Check / Lazarus relist path is an irreversible, high-impact
  // action (it closes and reopens the listing under a new eBay item id), so
  // it requires a longer history (7 days) than the other, reversible rules
  // below before it's allowed to arm.
  const hasEnoughHistoryForLazarus = snapshot.history.length >= 7;
  const isCompletelyDead =
    hasEnoughHistoryForLazarus && recentSales === 0 && snapshot.today.watchCount === 0 && (snapshot.today.impressionCount ?? 0) === 0;

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

  const insights = await getMarketInsights(accessToken, snapshot.title, snapshot.categoryId, snapshot.ebayItemId);

  // --- CTR / interest-without-sales signals (Analytics API data) ---
  // impressionCount/clickThroughRate are null when Analytics data isn't
  // available yet (e.g. brand-new listing, API outage) — every rule below
  // must no-op gracefully in that case rather than misfiring on 0-as-null.
  const ctr = snapshot.today.clickThroughRate;
  const impressions = snapshot.today.impressionCount ?? 0;
  const hasReliableCtr = snapshot.today.impressionCount !== null && ctr !== null && impressions >= MIN_IMPRESSIONS_FOR_CTR_RULES;
  const ctrLowSignal = hasReliableCtr && (ctr as number) < LOW_CTR_THRESHOLD;
  const ctrHighNoSalesSignal = hasReliableCtr && (ctr as number) >= HIGH_CTR_THRESHOLD && recentSales === 0;
  // "Interesse senza vendite": either the classic watcher-based signal or the
  // CTR-based one (clicks are happening but nobody buys) qualifies.
  const watcherInterestNoSales = hasEnoughHistory && snapshot.today.watchCount >= 3 && recentSales === 0;
  const interestWithoutSalesSignal = ctrHighNoSalesSignal || watcherInterestNoSales;

  // When the market sample is insufficient, averagePrice is null and the
  // market-anchored rules below are skipped entirely (silence beats noise)
  // in favour of the old fallback discount rule further down.
  if (insights.averagePrice !== null) {
    const avg = insights.averagePrice;
    const highThreshold = avg * 1.15;
    const lowThreshold = avg * 0.85;

    if (snapshot.today.price > highThreshold && interestWithoutSalesSignal) {
      const proposedPrice = clampPriceStep(snapshot.today.price, avg * 1.05);
      const ctrNote = ctrHighNoSalesSignal
        ? ` Il CTR è alto (${(ctr as number).toFixed(1)}%, ${impressions.toLocaleString()} impression) ma nessuna vendita: chi clicca poi trova il prezzo fuori mercato e rinuncia.`
        : '';
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: proposedPrice.toFixed(2),
        rationale: `Il tuo prezzo (${snapshot.today.price.toFixed(2)}€) è molto sopra la media di mercato (${avg.toFixed(2)}€, calcolata su ${insights.competitorCount} concorrenti) e nonostante l'interesse non arrivano vendite.${ctrNote} Abbasso a ${proposedPrice.toFixed(2)}€ per sbloccare le vendite.`,
        impact: 'high',
        actionable: true,
      });
    } else if (snapshot.today.price < lowThreshold) {
      const proposedPrice = clampPriceStep(snapshot.today.price, avg * 0.95);
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: proposedPrice.toFixed(2),
        rationale: `Il tuo prezzo (${snapshot.today.price.toFixed(2)}€) è molto inferiore alla media di mercato (${avg.toFixed(2)}€, calcolata su ${insights.competitorCount} concorrenti): sei sotto il mercato, stai lasciando margine sul tavolo. Alzalo a ${proposedPrice.toFixed(2)}€.`,
        impact: 'high',
        actionable: true,
      });
    } else if (snapshot.today.price <= highThreshold && snapshot.today.price >= lowThreshold) {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: snapshot.today.price.toFixed(2),
        rationale: `Il tuo prezzo è perfettamente in linea con la media di mercato attuale (${avg.toFixed(2)}€, calcolata su ${insights.competitorCount} concorrenti). Nessuna modifica necessaria.`,
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
  // "Alta visibilità, basso interesse": eBay mostra l'inserzione (impression
  // sufficienti) ma quasi nessuno clicca → titolo/foto principale non
  // attirano. Segnale più forte e più affidabile del solo calo osservatori,
  // perché si basa su dati Analytics reali invece che sulla media storica.
  const titleRuleTriggered = visibilityDropped || ctrLowSignal;

  if (titleRuleTriggered && snapshot.today.adRatePercent != null && !ctrLowSignal) {
    // La % ads nota resta il segnale preferito SOLO quando non c'è un
    // segnale CTR più forte: se il CTR è basso il problema è il titolo/foto,
    // non la spesa in ads, quindi il ramo ad_rate va saltato in quel caso.
    const proposedRate = Math.min(snapshot.today.adRatePercent + 2, 20);
    proposals.push({
      field: 'ad_rate',
      currentValue: `${snapshot.today.adRatePercent}%`,
      proposedValue: `${proposedRate}%`,
      rationale: `Scarso interesse: oggi ${snapshot.today.watchCount} osservatori. Un piccolo boost alle ads può aiutare l'algoritmo di eBay.`,
      impact: 'normal',
      actionable: true,
    });
  } else if (titleRuleTriggered) {
    const ctrRationale = ctrLowSignal
      ? `Le tue inserzioni compaiono nelle ricerche (${impressions.toLocaleString()} impression negli ultimi 30 giorni) ma quasi nessuno clicca (CTR ${(ctr as number).toFixed(1)}%): il titolo o la foto principale non attirano.`
      : null;

    if (insights.suggestedTitle) {
      proposals.push({
        field: 'title',
        currentValue: snapshot.title,
        proposedValue: insights.suggestedTitle,
        rationale:
          ctrRationale ??
          `Attenzione scarsa o in calo. Ho generato un nuovo titolo mixando le keyword esatte usate dai concorrenti più popolari per spingere la SEO al massimo!`,
        impact: 'high',
        actionable: true,
      });
    } else if (ctrLowSignal) {
      // CTR-based signal is strong enough on its own to act, even without a
      // market-suggested title: we don't have concrete new copy to apply
      // automatically, so this stays informational (no proposedValue to
      // push live to eBay) but is still surfaced with the real numbers.
      proposals.push({
        field: 'title',
        currentValue: snapshot.title,
        proposedValue: 'aggiungi dettagli specifici: modello, colore, materiale, dimensioni',
        rationale: ctrRationale as string,
        impact: 'high',
        actionable: false,
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

  // --- Classica logica prezzo con storico (fallback quando manca il mercato) ---
  // Attiva SOLO quando i dati di mercato sono insufficienti: se abbiamo una
  // media di mercato attendibile, il prezzo va ancorato ad essa (vedi sopra)
  // invece di applicare uno sconto lineare del 10% alla cieca.
  if (insights.averagePrice === null && hasEnoughHistory && snapshot.today.watchCount >= 3 && recentSales === 0) {
    const discountedPrice = clampPriceStep(snapshot.today.price, Math.round(snapshot.today.price * 0.9 * 100) / 100);
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
