import { getMarketAveragePrice } from './marketAnalysis';

export interface MetricPoint {
  metricDate: string;
  watchCount: number;
  quantitySold: number;
  revenue: number;
  price: number;
  adRatePercent: number | null;
}

export interface ListingSnapshot {
  listingId: number;
  title: string;
  categoryId: string | null;
  today: MetricPoint;
  history: MetricPoint[];
}

export interface ProposalDraft {
  field: 'title' | 'price' | 'category' | 'ad_rate';
  currentValue: string;
  proposedValue: string;
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

  // Analisi di Mercato (Giorno 1 o in caso di crollo vendite)
  const marketAverage = await getMarketAveragePrice(accessToken, snapshot.title, snapshot.categoryId);
  if (marketAverage !== null) {
    const highThreshold = marketAverage * 1.05;
    const lowThreshold = marketAverage * 0.85;

    if (snapshot.today.price > highThreshold) {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: marketAverage.toFixed(2),
        rationale: `Il mercato vende oggetti simili a una media di ${marketAverage.toFixed(2)}€. Il tuo prezzo (${snapshot.today.price.toFixed(2)}€) è fuori mercato. Allinealo per sbloccare le vendite!`,
        impact: 'high',
        actionable: true,
      });
    } else if (snapshot.today.price < lowThreshold) {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: (marketAverage * 0.95).toFixed(2),
        rationale: `Il tuo prezzo (${snapshot.today.price.toFixed(2)}€) è molto inferiore alla media di mercato (${marketAverage.toFixed(2)}€). Puoi permetterti di alzarlo e guadagnare di più!`,
        impact: 'high',
        actionable: true,
      });
    } else {
      proposals.push({
        field: 'price',
        currentValue: snapshot.today.price.toFixed(2),
        proposedValue: snapshot.today.price.toFixed(2),
        rationale: `Il tuo prezzo è perfettamente in linea con la media di mercato attuale (${marketAverage.toFixed(2)}€). Nessuna modifica necessaria.`,
        impact: 'normal',
        actionable: false,
      });
    }
  }

  const noInterestAtAll = snapshot.today.watchCount === 0;

  if (noInterestAtAll && recentSales === 0) {
    proposals.push({
      field: 'category',
      currentValue: snapshot.categoryId ?? 'sconosciuta',
      proposedValue: 'rivedi manualmente la categoria e le keyword del titolo',
      rationale: `Nessun interesse (0 osservatori oggi) e nessuna vendita. Se l'oggetto è online da molto, la categoria o il titolo potrebbero essere errati.`,
      impact: 'high',
      actionable: false,
    });
    // Continuiamo l'analisi per vedere se proporre anche altro
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

  if (hasEnoughHistory && snapshot.today.watchCount >= 3 && recentSales === 0) {
    const discountedPrice = Math.round(snapshot.today.price * 0.9 * 100) / 100;
    // Evitiamo di sovrascrivere o proporre due sconti di prezzo se il mercato ha già fatto la sua proposta
    if (!proposals.some(p => p.field === 'price')) {
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
