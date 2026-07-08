import { after } from 'next/server';
import type { CommandHandler } from './types';

// Avvia manualmente la stessa analisi del cron giornaliero.
// Risponde subito su Telegram e lancia il lavoro DOPO la risposta HTTP
// (via `after`), così il webhook non va in timeout e Telegram non
// ri-consegna l'update facendo partire l'analisi due volte.
export const handleAnalyze: CommandHandler = async () => {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    return { text: 'Configurazione mancante: servono NEXT_PUBLIC_APP_URL e CRON_SECRET.' };
  }

  after(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/cron/daily-analysis`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) {
        console.error(`Analisi manuale fallita: status ${res.status}`);
      }
    } catch (err) {
      console.error('Analisi manuale fallita:', err);
    }
  });

  return {
    text: '🔄 Analisi avviata: raccolgo le metriche da eBay e genero le proposte. Il recap arriva tra qualche istante.',
  };
};
