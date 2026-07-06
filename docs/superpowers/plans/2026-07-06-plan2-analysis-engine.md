# eBay Agent — Piano 2a: Motore di Analisi e Proposte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire il motore che raccoglie ogni giorno le metriche delle inserzioni eBay monitorate, genera proposte di ottimizzazione (prezzo e, quando disponibile, % ads), le manda su Telegram con bottoni di approvazione, applica le modifiche approvate su eBay, e fornisce un recap manuale e uno automatico giornaliero.

**Architecture:** Estende il backend Next.js/Supabase/Telegram già esistente. Un cron Vercel giornaliero orchestrà raccolta metriche (Trading API `GetMyeBaySelling`) → motore di analisi a regole fisse → generazione/persistenza proposte → invio Telegram (bottoni inline per le proposte "azionabili", note informative per quelle "consultive"). Un webhook già esistente viene esteso per gestire i tap sui bottoni (`callback_query`) e applicare le modifiche approvate (Trading API `ReviseItem`).

**Tech Stack:** Stesso stack del Piano 1 (Next.js App Router + TypeScript, Supabase, Vitest) più `fast-xml-parser` (già installato).

## Nota sullo scope

Questo piano copre tutto tranne la gestione della % Promoted Listings via Marketing API (che richiede gestione di "campagne" pubblicitarie, la parte più delicata) — il codice è già predisposto per accoglierla (campo `ad_rate` nel motore di analisi e nell'applicazione modifiche), ma nessuna proposta `ad_rate` verrà mai generata finché il Piano 2b non aggiunge la lettura della % ads reale. Riferimento: [`docs/superpowers/specs/2026-07-06-plan2-analysis-engine-design.md`](../specs/2026-07-06-plan2-analysis-engine-design.md).

## Global Constraints

- Nessuna modifica viene applicata su eBay senza approvazione esplicita via bottone Telegram.
- Solo le proposte "azionabili" (prezzo, e in futuro % ads) hanno un valore concreto calcolato e possono essere applicate automaticamente; le proposte "consultive" (titolo, categoria) sono solo testo informativo nel recap, senza bottoni.
- Motore di analisi a regole fisse, deterministico — nessuna chiamata a modelli esterni.
- Tutti i testi inviati dal bot sono in italiano.
- Il bot risponde/agisce solo per il chat_id autorizzato (`TELEGRAM_OWNER_CHAT_ID`), anche per i tap sui bottoni.
- Recap automatico giornaliero alle 19:00 UTC (20:00 ora italiana in inverno); recap manuale disponibile in ogni momento con `/recap <id>`.
- Se una modifica approvata fallisce lato eBay, lo stato della proposta diventa "failed" e l'errore specifico viene comunicato su Telegram — nessun fallimento silenzioso.

---

### Task 1: Bottoni inline Telegram

**Files:**
- Modify: `src/lib/telegram.ts`
- Test: `tests/lib/telegram.test.ts`

**Interfaces:**
- Consumes: nessuna (estende modulo esistente)
- Produces: `InlineKeyboardButton = { text: string; callback_data: string }`, `InlineKeyboardMarkup = { inline_keyboard: InlineKeyboardButton[][] }`, `sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void>` (firma estesa, retrocompatibile), `answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>` da `@/lib/telegram`. Usati dalla generazione proposte (Task 5) e dalla gestione callback (Task 7/8).

- [ ] **Step 1: Scrivi i test per il nuovo comportamento**

Aggiungi in `tests/lib/telegram.test.ts`, dentro il `describe('telegram client', ...)` esistente, dopo i test già presenti (prima della chiusura `});`):

```ts
  it('include reply_markup quando fornito a sendMessage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(42, 'scegli', {
      inline_keyboard: [[{ text: 'Approva', callback_data: 'proposal:1:approve' }]],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: 42,
          text: 'scegli',
          reply_markup: { inline_keyboard: [[{ text: 'Approva', callback_data: 'proposal:1:approve' }]] },
        }),
      })
    );
  });

  it('non include reply_markup se non fornito', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(42, 'ciao');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({ body: JSON.stringify({ chat_id: 42, text: 'ciao' }) })
    );
  });

  it('answerCallbackQuery chiama l\'API corretta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { answerCallbackQuery } = await import('@/lib/telegram');
    await answerCallbackQuery('cbq-1', 'fatto');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/answerCallbackQuery',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ callback_query_id: 'cbq-1', text: 'fatto' }),
      })
    );
  });

  it('answerCallbackQuery lancia un errore se Telegram risponde con errore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { answerCallbackQuery } = await import('@/lib/telegram');
    await expect(answerCallbackQuery('cbq-1')).rejects.toThrow(
      'Telegram answerCallbackQuery fallita (status 400)'
    );
  });
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/telegram.test.ts`
Expected: FAIL — `sendMessage` non accetta un terzo argomento, `answerCallbackQuery` non esiste

- [ ] **Step 3: Implementa le modifiche in `src/lib/telegram.ts`**

Aggiungi questi due tipi sotto le interfacce esistenti (`TelegramUpdate`, ecc.):

```ts
export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}
```

Sostituisci la funzione `sendMessage` esistente con:

```ts
export async function sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  const res = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage fallita (status ${res.status})`);
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const res = await fetch(apiUrl('answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram answerCallbackQuery fallita (status ${res.status})`);
  }
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/telegram.test.ts`
Expected: PASS (9 test passed)

- [ ] **Step 5: Esegui l'intera suite per verificare che non ci siano regressioni**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram.ts tests/lib/telegram.test.ts
git commit -m "feat: add Telegram inline keyboard and callback query support"
```

---

### Task 2: Lettura metriche eBay (watcher, vendite, prezzo)

**Files:**
- Modify: `src/lib/ebayTrading.ts`
- Test: `tests/lib/ebayTrading.test.ts`

**Interfaces:**
- Consumes: nessuna
- Produces: `EbaySellingSnapshotItem = { itemId: string; title: string; categoryId: string; watchCount: number; price: number }`, `EbaySoldItem = { itemId: string; quantitySold: number; revenue: number }`, `EbaySellingSnapshot = { listings: EbaySellingSnapshotItem[]; soldItems: EbaySoldItem[] }`, `getSellingSnapshot(accessToken: string): Promise<EbaySellingSnapshot>` da `@/lib/ebayTrading`. Usato dalla raccolta metriche (Task 3).

- [ ] **Step 1: Scrivi i test per `getSellingSnapshot`**

Aggiungi in `tests/lib/ebayTrading.test.ts`, sotto i test esistenti di `getActiveListings` (non li tocchiamo):

```ts
import { getSellingSnapshot } from '@/lib/ebayTrading';

describe('getSellingSnapshot', () => {
  it('estrae watcher, prezzo e vendite dalla risposta XML', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>
      <Item>
        <ItemID>123456789012</ItemID>
        <Title>Prodotto Uno</Title>
        <PrimaryCategory><CategoryID>111</CategoryID></PrimaryCategory>
        <WatchCount>7</WatchCount>
        <StartPrice>19.99</StartPrice>
      </Item>
    </ItemArray>
  </ActiveList>
  <SoldList>
    <OrderTransactionArray>
      <OrderTransaction>
        <Transaction>
          <Item><ItemID>123456789012</ItemID></Item>
          <QuantityPurchased>2</QuantityPurchased>
          <TransactionPrice>19.99</TransactionPrice>
        </Transaction>
      </OrderTransaction>
    </OrderTransactionArray>
  </SoldList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const snapshot = await getSellingSnapshot('access-token');

    expect(snapshot.listings).toEqual([
      { itemId: '123456789012', title: 'Prodotto Uno', categoryId: '111', watchCount: 7, price: 19.99 },
    ]);
    expect(snapshot.soldItems).toEqual([{ itemId: '123456789012', quantitySold: 2, revenue: 39.98 }]);
  });

  it('somma più transazioni per lo stesso itemId', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList><ItemArray></ItemArray></ActiveList>
  <SoldList>
    <OrderTransactionArray>
      <OrderTransaction>
        <Transaction>
          <Item><ItemID>111</ItemID></Item>
          <QuantityPurchased>1</QuantityPurchased>
          <TransactionPrice>10</TransactionPrice>
        </Transaction>
      </OrderTransaction>
      <OrderTransaction>
        <Transaction>
          <Item><ItemID>111</ItemID></Item>
          <QuantityPurchased>1</QuantityPurchased>
          <TransactionPrice>10</TransactionPrice>
        </Transaction>
      </OrderTransaction>
    </OrderTransactionArray>
  </SoldList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const snapshot = await getSellingSnapshot('access-token');

    expect(snapshot.soldItems).toEqual([{ itemId: '111', quantitySold: 2, revenue: 20 }]);
  });

  it('ritorna array vuoti se non ci sono inserzioni né vendite', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList></ActiveList>
  <SoldList></SoldList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const snapshot = await getSellingSnapshot('access-token');

    expect(snapshot).toEqual({ listings: [], soldItems: [] });
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/ebayTrading.test.ts`
Expected: FAIL — `getSellingSnapshot` non esiste

- [ ] **Step 3: Implementa `getSellingSnapshot` in `src/lib/ebayTrading.ts`**

Aggiungi in cima al file, sotto gli import esistenti:

```ts
export interface EbaySellingSnapshotItem {
  itemId: string;
  title: string;
  categoryId: string;
  watchCount: number;
  price: number;
}

export interface EbaySoldItem {
  itemId: string;
  quantitySold: number;
  revenue: number;
}

export interface EbaySellingSnapshot {
  listings: EbaySellingSnapshotItem[];
  soldItems: EbaySoldItem[];
}
```

Aggiungi in fondo al file:

```ts
const SNAPSHOT_REQUEST_BODY = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
    <IncludeWatchCount>true</IncludeWatchCount>
  </ActiveList>
  <SoldList>
    <Sort>TimeLeft</Sort>
    <DurationInDays>1</DurationInDays>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </SoldList>
</GetMyeBaySellingRequest>`;

export async function getSellingSnapshot(accessToken: string): Promise<EbaySellingSnapshot> {
  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: SNAPSHOT_REQUEST_BODY,
  });

  if (!res.ok) {
    throw new Error(`GetMyeBaySelling fallita (status ${res.status})`);
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const ack = parsed?.GetMyeBaySellingResponse?.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const message = parsed?.GetMyeBaySellingResponse?.Errors?.LongMessage ?? 'risposta eBay non valida';
    throw new Error(`GetMyeBaySelling ha restituito un errore: ${message}`);
  }

  const items = toArray(parsed?.GetMyeBaySellingResponse?.ActiveList?.ItemArray?.Item);
  const listings: EbaySellingSnapshotItem[] = items.map((item: any) => ({
    itemId: String(item.ItemID),
    title: String(item.Title),
    categoryId: String(item.PrimaryCategory?.CategoryID ?? ''),
    watchCount: Number(item.WatchCount ?? 0),
    price: Number(item.StartPrice ?? 0),
  }));

  const transactions = toArray(parsed?.GetMyeBaySellingResponse?.SoldList?.OrderTransactionArray?.OrderTransaction);
  const soldByItemId = new Map<string, { quantitySold: number; revenue: number }>();
  for (const orderTransaction of transactions) {
    const transaction = orderTransaction?.Transaction ?? orderTransaction;
    const itemId = String(transaction?.Item?.ItemID ?? '');
    if (!itemId) continue;
    const quantity = Number(transaction?.QuantityPurchased ?? 0);
    const price = Number(transaction?.TransactionPrice ?? 0);
    const existing = soldByItemId.get(itemId) ?? { quantitySold: 0, revenue: 0 };
    soldByItemId.set(itemId, {
      quantitySold: existing.quantitySold + quantity,
      revenue: Math.round((existing.revenue + quantity * price) * 100) / 100,
    });
  }
  const soldItems: EbaySoldItem[] = Array.from(soldByItemId.entries()).map(([itemId, totals]) => ({
    itemId,
    ...totals,
  }));

  return { listings, soldItems };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/ebayTrading.test.ts`
Expected: PASS (8 test passed)

- [ ] **Step 5: Esegui l'intera suite**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 6: Commit**

```bash
git add src/lib/ebayTrading.ts tests/lib/ebayTrading.test.ts
git commit -m "feat: add getSellingSnapshot for watcher/price/sales metrics"
```

---

### Task 3: Raccolta e salvataggio giornaliero delle metriche

**Files:**
- Create: `supabase/migrations/0003_daily_metrics.sql`
- Create: `src/lib/metricsCollector.ts`
- Test: `tests/lib/metricsCollector.test.ts`

**Interfaces:**
- Consumes: `getSellingSnapshot` da `@/lib/ebayTrading` (Task 2); `refreshAccessToken` da `@/lib/ebayOAuth`; tabelle `watched_listings`, `ebay_connection`
- Produces: `collectDailyMetrics(supabase: SupabaseClient, chatId: number): Promise<{ collected: number; errors: string[] }>` da `@/lib/metricsCollector`. Tabella `daily_metrics(id, listing_id, metric_date, watch_count, quantity_sold, revenue, price, ad_rate_percent, created_at)`. Usato dal cron (Task 9) e dal recap manuale (Task 10).

- [ ] **Step 1: Crea la migrazione**

```sql
-- supabase/migrations/0003_daily_metrics.sql
create table if not exists daily_metrics (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  metric_date date not null,
  watch_count integer not null default 0,
  quantity_sold integer not null default 0,
  revenue numeric not null default 0,
  price numeric not null default 0,
  ad_rate_percent numeric,
  created_at timestamptz not null default now(),
  unique (listing_id, metric_date)
);

create index if not exists daily_metrics_listing_id_idx on daily_metrics (listing_id);
```

- [ ] **Step 2: Scrivi i test per `collectDailyMetrics`**

```ts
// tests/lib/metricsCollector.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayTrading', () => ({ getSellingSnapshot: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { getSellingSnapshot } from '@/lib/ebayTrading';
import { collectDailyMetrics } from '@/lib/metricsCollector';

describe('collectDailyMetrics', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(getSellingSnapshot).mockReset();
  });

  it('ritorna 0 raccolte se non c\'è nessun collegamento eBay', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await collectDailyMetrics(supabase, 210039451);
    expect(result).toEqual({ collected: 0, errors: [] });
    expect(getSellingSnapshot).not.toHaveBeenCalled();
  });

  it('salva le metriche per ogni prodotto monitorato trovato nello snapshot eBay', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getSellingSnapshot).mockResolvedValue({
      listings: [{ itemId: 'AAA', title: 'Prodotto A', categoryId: '1', watchCount: 5, price: 10 }],
      soldItems: [{ itemId: 'AAA', quantitySold: 2, revenue: 20 }],
    });
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null }, // ebay_connection
      { data: [{ id: 1, ebay_item_id: 'AAA' }], error: null }, // watched_listings attivi
      { data: null, error: null }, // upsert daily_metrics
    ]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result).toEqual({ collected: 1, errors: [] });
  });

  it('salta i prodotti monitorati non trovati nello snapshot e lo segnala come errore', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(getSellingSnapshot).mockResolvedValue({ listings: [], soldItems: [] });
    const supabase = createFakeSupabase([
      { data: { refresh_token: 'rt-1' }, error: null },
      { data: [{ id: 1, ebay_item_id: 'AAA', title: 'Prodotto A' }], error: null },
    ]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result.collected).toBe(0);
    expect(result.errors).toEqual(['Prodotto Prodotto A: non trovato tra le inserzioni attive eBay']);
  });

  it('segnala un errore se il rinnovo del token fallisce, senza interrompere', async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error('refresh non valido'));
    const supabase = createFakeSupabase([{ data: { refresh_token: 'rt-1' }, error: null }]);

    const result = await collectDailyMetrics(supabase, 210039451);

    expect(result).toEqual({ collected: 0, errors: ['Rinnovo token eBay fallito: refresh non valido'] });
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/metricsCollector.test.ts`
Expected: FAIL — `Cannot find module '@/lib/metricsCollector'`

- [ ] **Step 4: Implementa `src/lib/metricsCollector.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshAccessToken } from './ebayOAuth';
import { getSellingSnapshot } from './ebayTrading';

export interface CollectMetricsResult {
  collected: number;
  errors: string[];
}

export async function collectDailyMetrics(supabase: SupabaseClient, chatId: number): Promise<CollectMetricsResult> {
  const { data: connection } = await supabase
    .from('ebay_connection')
    .select('refresh_token')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!connection?.refresh_token) {
    return { collected: 0, errors: [] };
  }

  let accessToken: string;
  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    accessToken = tokens.accessToken;
  } catch (err) {
    return { collected: 0, errors: [`Rinnovo token eBay fallito: ${(err as Error).message}`] };
  }

  const { data: listings } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, title')
    .eq('chat_id', chatId)
    .eq('status', 'active');

  const snapshot = await getSellingSnapshot(accessToken);
  const snapshotById = new Map(snapshot.listings.map((item) => [item.itemId, item]));
  const soldById = new Map(snapshot.soldItems.map((item) => [item.itemId, item]));

  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  let collected = 0;

  for (const listing of listings ?? []) {
    const snapshotItem = snapshotById.get(listing.ebay_item_id);
    if (!snapshotItem) {
      errors.push(`Prodotto ${listing.title}: non trovato tra le inserzioni attive eBay`);
      continue;
    }
    const sold = soldById.get(listing.ebay_item_id);

    await supabase.from('daily_metrics').upsert(
      {
        listing_id: listing.id,
        metric_date: today,
        watch_count: snapshotItem.watchCount,
        quantity_sold: sold?.quantitySold ?? 0,
        revenue: sold?.revenue ?? 0,
        price: snapshotItem.price,
      },
      { onConflict: 'listing_id,metric_date' }
    );
    collected += 1;
  }

  return { collected, errors };
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/metricsCollector.test.ts`
Expected: PASS (4 test passed)

- [ ] **Step 6: Esegui l'intera suite**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0003_daily_metrics.sql src/lib/metricsCollector.ts tests/lib/metricsCollector.test.ts
git commit -m "feat: add daily metrics collection from eBay"
```

---

### Task 4: Motore di analisi (regole)

**Files:**
- Create: `src/lib/analysisEngine.ts`
- Test: `tests/lib/analysisEngine.test.ts`

**Interfaces:**
- Consumes: nessuna (funzione pura)
- Produces: `MetricPoint = { metricDate: string; watchCount: number; quantitySold: number; revenue: number; price: number; adRatePercent: number | null }`, `ListingSnapshot = { listingId: number; title: string; categoryId: string | null; today: MetricPoint; history: MetricPoint[] }`, `ProposalDraft = { field: 'title' | 'price' | 'category' | 'ad_rate'; currentValue: string; proposedValue: string; rationale: string; impact: 'normal' | 'high'; actionable: boolean }`, `analyzeListing(snapshot: ListingSnapshot): ProposalDraft[]` da `@/lib/analysisEngine`. Usato dalla generazione proposte (Task 5).

- [ ] **Step 1: Scrivi i test per ciascuna regola**

```ts
// tests/lib/analysisEngine.test.ts
import { describe, it, expect } from 'vitest';
import { analyzeListing, type ListingSnapshot, type MetricPoint } from '@/lib/analysisEngine';

function metric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metricDate: '2026-07-01',
    watchCount: 10,
    quantitySold: 0,
    revenue: 0,
    price: 20,
    adRatePercent: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ListingSnapshot> = {}): ListingSnapshot {
  return {
    listingId: 1,
    title: 'Prodotto Test',
    categoryId: '123',
    today: metric(),
    history: [],
    ...overrides,
  };
}

describe('analyzeListing', () => {
  it('non genera proposte se non c\'è abbastanza storico e i numeri sono normali', () => {
    const result = analyzeListing(snapshot());
    expect(result).toEqual([]);
  });

  it('propone il cambio categoria se non c\'è interesse né vendite da giorni', () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 1, quantitySold: 0 }), history }));

    expect(result).toEqual([
      {
        field: 'category',
        currentValue: '123',
        proposedValue: 'rivedi manualmente la categoria e le keyword del titolo',
        rationale: 'Nessun interesse (oggi 1 watcher, media recente 10.0) e nessuna vendita da almeno 3 giorni.',
        impact: 'high',
        actionable: false,
      },
    ]);
  });

  it('propone di rivedere il titolo se le visite calano e non c\'è ancora una % ads nota', () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 2 }), history }));

    expect(result).toEqual([
      {
        field: 'title',
        currentValue: 'Prodotto Test',
        proposedValue: 'rivedi il titolo con keyword più cercate',
        rationale: 'Visite in calo: oggi 2 watcher contro una media di 10.0.',
        impact: 'normal',
        actionable: false,
      },
    ]);
  });

  it('propone di alzare la % ads se le visite calano e la % ads è nota', () => {
    const history = [metric({ watchCount: 10, adRatePercent: 5 }), metric({ watchCount: 10, adRatePercent: 5 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 2, adRatePercent: 5 }), history }));

    expect(result).toEqual([
      {
        field: 'ad_rate',
        currentValue: '5%',
        proposedValue: '7%',
        rationale: 'Visite in calo: oggi 2 watcher contro una media di 10.0.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });

  it('propone uno sconto del 10% se c\'è interesse ma nessuna vendita', () => {
    const history = [metric({ watchCount: 8, quantitySold: 0 }), metric({ watchCount: 8, quantitySold: 0 }), metric({ watchCount: 8, quantitySold: 0 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 8, quantitySold: 0, price: 20 }), history }));

    expect(result).toEqual([
      {
        field: 'price',
        currentValue: '20.00',
        proposedValue: '18.00',
        rationale: 'Interesse presente (8 watcher) ma nessuna vendita da almeno 3 giorni: sconto del 10% proposto.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });

  it('propone di abbassare la % ads se è stata aumentata senza risultati', () => {
    const history = [metric({ watchCount: 10, adRatePercent: 5 })];
    const result = analyzeListing(snapshot({ today: metric({ watchCount: 10, adRatePercent: 8 }), history }));

    expect(result).toEqual([
      {
        field: 'ad_rate',
        currentValue: '8%',
        proposedValue: '6%',
        rationale: 'La % ads è stata aumentata di recente ma le visite non sono aumentate in proporzione: valuta di ridurla.',
        impact: 'normal',
        actionable: true,
      },
    ]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/analysisEngine.test.ts`
Expected: FAIL — `Cannot find module '@/lib/analysisEngine'`

- [ ] **Step 3: Implementa `src/lib/analysisEngine.ts`**

```ts
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

export function analyzeListing(snapshot: ListingSnapshot): ProposalDraft[] {
  const proposals: ProposalDraft[] = [];
  const avgWatch = average(snapshot.history.map((h) => h.watchCount));
  const recentSales = snapshot.history.reduce((sum, h) => sum + h.quantitySold, 0) + snapshot.today.quantitySold;
  const hasEnoughHistory = snapshot.history.length >= 3;

  const noInterestAtAll = avgWatch > 0 ? snapshot.today.watchCount < avgWatch * 0.3 : snapshot.today.watchCount === 0;

  if (hasEnoughHistory && noInterestAtAll && recentSales === 0) {
    proposals.push({
      field: 'category',
      currentValue: snapshot.categoryId ?? 'sconosciuta',
      proposedValue: 'rivedi manualmente la categoria e le keyword del titolo',
      rationale: `Nessun interesse (oggi ${snapshot.today.watchCount} watcher, media recente ${avgWatch.toFixed(1)}) e nessuna vendita da almeno ${snapshot.history.length} giorni.`,
      impact: 'high',
      actionable: false,
    });
    return proposals;
  }

  const visibilityDropped = avgWatch > 0 && snapshot.today.watchCount < avgWatch * 0.7;
  if (visibilityDropped) {
    if (snapshot.today.adRatePercent != null) {
      const proposedRate = Math.min(snapshot.today.adRatePercent + 2, 20);
      proposals.push({
        field: 'ad_rate',
        currentValue: `${snapshot.today.adRatePercent}%`,
        proposedValue: `${proposedRate}%`,
        rationale: `Visite in calo: oggi ${snapshot.today.watchCount} watcher contro una media di ${avgWatch.toFixed(1)}.`,
        impact: 'normal',
        actionable: true,
      });
    } else {
      proposals.push({
        field: 'title',
        currentValue: snapshot.title,
        proposedValue: 'rivedi il titolo con keyword più cercate',
        rationale: `Visite in calo: oggi ${snapshot.today.watchCount} watcher contro una media di ${avgWatch.toFixed(1)}.`,
        impact: 'normal',
        actionable: false,
      });
    }
  }

  if (hasEnoughHistory && snapshot.today.watchCount >= 3 && recentSales === 0) {
    const discountedPrice = Math.round(snapshot.today.price * 0.9 * 100) / 100;
    proposals.push({
      field: 'price',
      currentValue: snapshot.today.price.toFixed(2),
      proposedValue: discountedPrice.toFixed(2),
      rationale: `Interesse presente (${snapshot.today.watchCount} watcher) ma nessuna vendita da almeno ${snapshot.history.length} giorni: sconto del 10% proposto.`,
      impact: 'normal',
      actionable: true,
    });
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
      rationale: 'La % ads è stata aumentata di recente ma le visite non sono aumentate in proporzione: valuta di ridurla.',
      impact: 'normal',
      actionable: true,
    });
  }

  return proposals;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/analysisEngine.test.ts`
Expected: PASS (6 test passed)

- [ ] **Step 5: Esegui l'intera suite**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 6: Commit**

```bash
git add src/lib/analysisEngine.ts tests/lib/analysisEngine.test.ts
git commit -m "feat: add rule-based listing analysis engine"
```

---

### Task 5: Generazione, persistenza e invio delle proposte

**Files:**
- Create: `supabase/migrations/0004_proposals.sql`
- Create: `src/lib/proposalGenerator.ts`
- Test: `tests/lib/proposalGenerator.test.ts`

**Interfaces:**
- Consumes: `analyzeListing`, `ListingSnapshot`, `ProposalDraft` da `@/lib/analysisEngine` (Task 4); `sendMessage`, `InlineKeyboardMarkup` da `@/lib/telegram` (Task 1); tabella `daily_metrics` (Task 3)
- Produces: `generateAndSendProposals(supabase: SupabaseClient, chatId: number, listingId: number, snapshot: ListingSnapshot): Promise<{ sent: number; informational: string[] }>` da `@/lib/proposalGenerator`. Tabella `proposals(id, listing_id, proposal_date, field, current_value, proposed_value, rationale, impact, status, telegram_message_id, created_at)`. Usato dal cron (Task 9).

- [ ] **Step 1: Crea la migrazione**

```sql
-- supabase/migrations/0004_proposals.sql
create table if not exists proposals (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  proposal_date date not null,
  field text not null check (field in ('title', 'price', 'category', 'ad_rate')),
  current_value text,
  proposed_value text not null,
  rationale text not null,
  impact text not null default 'normal' check (impact in ('normal', 'high')),
  status text not null default 'pending' check (status in ('pending', 'informational', 'approved', 'rejected', 'applied', 'failed')),
  telegram_message_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists proposals_listing_id_idx on proposals (listing_id);
```

- [ ] **Step 2: Scrivi i test per `generateAndSendProposals`**

```ts
// tests/lib/proposalGenerator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';

vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { sendMessage } from '@/lib/telegram';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import type { ListingSnapshot, MetricPoint } from '@/lib/analysisEngine';

function metric(overrides: Partial<MetricPoint> = {}): MetricPoint {
  return {
    metricDate: '2026-07-01',
    watchCount: 10,
    quantitySold: 0,
    revenue: 0,
    price: 20,
    adRatePercent: null,
    ...overrides,
  };
}

describe('generateAndSendProposals', () => {
  beforeEach(() => {
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
  });

  it('non manda nulla se il motore non genera proposte', async () => {
    const snapshot: ListingSnapshot = {
      listingId: 1,
      title: 'Prodotto Test',
      categoryId: '1',
      today: metric(),
      history: [],
    };
    const supabase = createFakeSupabase([]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot);

    expect(result).toEqual({ sent: 0, informational: [] });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come informational e non manda bottoni per una proposta non azionabile', async () => {
    const history = [metric({ watchCount: 10 }), metric({ watchCount: 10 }), metric({ watchCount: 10 })];
    const snapshot: ListingSnapshot = {
      listingId: 1,
      title: 'Prodotto Test',
      categoryId: '1',
      today: metric({ watchCount: 1, quantitySold: 0 }),
      history,
    };
    const supabase = createFakeSupabase([{ data: { id: 99 }, error: null }]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot);

    expect(result.sent).toBe(0);
    expect(result.informational).toHaveLength(1);
    expect(result.informational[0]).toContain('categoria');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('salva come pending e manda un messaggio con bottoni per una proposta azionabile', async () => {
    const history = [
      metric({ watchCount: 8, quantitySold: 0 }),
      metric({ watchCount: 8, quantitySold: 0 }),
      metric({ watchCount: 8, quantitySold: 0 }),
    ];
    const snapshot: ListingSnapshot = {
      listingId: 1,
      title: 'Prodotto Test',
      categoryId: '1',
      today: metric({ watchCount: 8, quantitySold: 0, price: 20 }),
      history,
    };
    const supabase = createFakeSupabase([{ data: { id: 42 }, error: null }]);

    const result = await generateAndSendProposals(supabase, 210039451, 1, snapshot);

    expect(result.sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledWith(
      210039451,
      expect.stringContaining('Prodotto Test'),
      {
        inline_keyboard: [
          [
            { text: '✅ Approva', callback_data: 'proposal:42:approve' },
            { text: '❌ Rifiuta', callback_data: 'proposal:42:reject' },
          ],
        ],
      }
    );
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/proposalGenerator.test.ts`
Expected: FAIL — `Cannot find module '@/lib/proposalGenerator'`

- [ ] **Step 4: Implementa `src/lib/proposalGenerator.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeListing, type ListingSnapshot } from './analysisEngine';
import { sendMessage } from './telegram';

export interface GenerateProposalsResult {
  sent: number;
  informational: string[];
}

export async function generateAndSendProposals(
  supabase: SupabaseClient,
  chatId: number,
  listingId: number,
  snapshot: ListingSnapshot
): Promise<GenerateProposalsResult> {
  const drafts = analyzeListing(snapshot);
  const today = new Date().toISOString().slice(0, 10);
  const informational: string[] = [];
  let sent = 0;

  for (const draft of drafts) {
    const { data: inserted } = await supabase
      .from('proposals')
      .insert({
        listing_id: listingId,
        proposal_date: today,
        field: draft.field,
        current_value: draft.currentValue,
        proposed_value: draft.proposedValue,
        rationale: draft.rationale,
        impact: draft.impact,
        status: draft.actionable ? 'pending' : 'informational',
      })
      .select('id')
      .single();

    if (!draft.actionable) {
      informational.push(`${snapshot.title}: ${draft.rationale}`);
      continue;
    }

    const impactPrefix = draft.impact === 'high' ? '⚠️ Alto impatto\n' : '';
    const text = `${impactPrefix}📋 ${snapshot.title}\nCampo: ${draft.field}\nAttuale: ${draft.currentValue} → Proposto: ${draft.proposedValue}\nMotivo: ${draft.rationale}`;

    await sendMessage(chatId, text, {
      inline_keyboard: [
        [
          { text: '✅ Approva', callback_data: `proposal:${inserted.id}:approve` },
          { text: '❌ Rifiuta', callback_data: `proposal:${inserted.id}:reject` },
        ],
      ],
    });
    sent += 1;
  }

  return { sent, informational };
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/proposalGenerator.test.ts`
Expected: PASS (3 test passed)

- [ ] **Step 6: Esegui l'intera suite**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_proposals.sql src/lib/proposalGenerator.ts tests/lib/proposalGenerator.test.ts
git commit -m "feat: generate and send optimization proposals via Telegram"
```

---

### Task 6: Applicazione modifiche su eBay (ReviseItem)

**Files:**
- Create: `src/lib/ebayRevise.ts`
- Test: `tests/lib/ebayRevise.test.ts`

**Interfaces:**
- Consumes: nessuna
- Produces: `reviseListingPrice(accessToken: string, itemId: string, newPrice: number): Promise<void>`, `applyProposal(accessToken: string, itemId: string, field: string, proposedValue: string): Promise<void>` da `@/lib/ebayRevise`. Usato dalla gestione callback (Task 7).

- [ ] **Step 1: Scrivi i test**

```ts
// tests/lib/ebayRevise.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { reviseListingPrice, applyProposal } from '@/lib/ebayRevise';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviseListingPrice', () => {
  it('chiama ReviseItem con il nuovo prezzo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`,
    });
    vi.stubGlobal('fetch', fetchMock);

    await reviseListingPrice('access-token', '123456789012', 17.99);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain('<ItemID>123456789012</ItemID>');
    expect(options.body).toContain('<StartPrice>17.99</StartPrice>');
  });

  it('lancia un errore se la richiesta HTTP fallisce', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(reviseListingPrice('access-token', '123', 10)).rejects.toThrow('ReviseItem fallita (status 500)');
  });

  it('lancia un errore se eBay risponde con Ack Failure', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><LongMessage>Prezzo non valido</LongMessage></Errors>
</ReviseItemResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));
    await expect(reviseListingPrice('access-token', '123', 10)).rejects.toThrow(
      'ReviseItem ha restituito un errore: Prezzo non valido'
    );
  });
});

describe('applyProposal', () => {
  it('applica una modifica di prezzo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `<?xml version="1.0" encoding="UTF-8"?>
<ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`,
    });
    vi.stubGlobal('fetch', fetchMock);

    await applyProposal('access-token', '123456789012', 'price', '17.99');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lancia un errore per campi non supportati', async () => {
    await expect(applyProposal('access-token', '123', 'title', 'nuovo titolo')).rejects.toThrow(
      'Applicazione automatica non supportata per il campo "title"'
    );
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/ebayRevise.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ebayRevise'`

- [ ] **Step 3: Implementa `src/lib/ebayRevise.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';

export async function reviseListingPrice(accessToken: string, itemId: string, newPrice: number): Promise<void> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${newPrice.toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'ReviseItem',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: xmlBody,
  });

  if (!res.ok) {
    throw new Error(`ReviseItem fallita (status ${res.status})`);
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const ack = parsed?.ReviseItemResponse?.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const message = parsed?.ReviseItemResponse?.Errors?.LongMessage ?? 'risposta eBay non valida';
    throw new Error(`ReviseItem ha restituito un errore: ${message}`);
  }
}

export async function applyProposal(
  accessToken: string,
  itemId: string,
  field: string,
  proposedValue: string
): Promise<void> {
  switch (field) {
    case 'price':
      await reviseListingPrice(accessToken, itemId, Number(proposedValue));
      return;
    default:
      throw new Error(`Applicazione automatica non supportata per il campo "${field}"`);
  }
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/ebayRevise.test.ts`
Expected: PASS (5 test passed)

- [ ] **Step 5: Esegui l'intera suite**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 6: Commit**

```bash
git add src/lib/ebayRevise.ts tests/lib/ebayRevise.test.ts
git commit -m "feat: apply approved price proposals via eBay ReviseItem"
```

---

### Task 7: Gestione del callback di approvazione/rifiuto

**Files:**
- Create: `supabase/migrations/0005_change_log.sql`
- Create: `src/lib/callbackHandler.ts`
- Test: `tests/lib/callbackHandler.test.ts`

**Interfaces:**
- Consumes: `refreshAccessToken` da `@/lib/ebayOAuth`; `applyProposal` da `@/lib/ebayRevise` (Task 6); tabelle `proposals` (Task 5), `watched_listings`, `ebay_connection`
- Produces: `handleProposalCallback(supabase: SupabaseClient, callbackData: string): Promise<{ chatId: number; text: string } | null>` da `@/lib/callbackHandler`. Tabella `change_log(id, listing_id, proposal_id, field, previous_value, new_value, applied_at)`. Usato dalla route webhook (Task 8).

- [ ] **Step 1: Crea la migrazione**

```sql
-- supabase/migrations/0005_change_log.sql
create table if not exists change_log (
  id bigint generated always as identity primary key,
  listing_id bigint not null references watched_listings(id),
  proposal_id bigint references proposals(id),
  field text not null,
  previous_value text,
  new_value text not null,
  applied_at timestamptz not null default now()
);
```

- [ ] **Step 2: Scrivi i test per `handleProposalCallback`**

```ts
// tests/lib/callbackHandler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ebayOAuth', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/ebayRevise', () => ({ applyProposal: vi.fn() }));

import { refreshAccessToken } from '@/lib/ebayOAuth';
import { applyProposal } from '@/lib/ebayRevise';
import { handleProposalCallback } from '@/lib/callbackHandler';

function fakeSupabase(queue: Array<{ data: any; error: any }>) {
  let i = 0;
  const next = () => queue[Math.min(i++, queue.length - 1)];
  const builder: any = {
    from: () => builder,
    select: () => builder,
    update: () => builder,
    insert: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(next()),
    then: (resolve: any) => resolve(next()),
  };
  return builder;
}

describe('handleProposalCallback', () => {
  beforeEach(() => {
    vi.mocked(refreshAccessToken).mockReset();
    vi.mocked(applyProposal).mockReset();
  });

  it('ritorna null se il formato di callback_data non è riconosciuto', async () => {
    const supabase = fakeSupabase([]);
    const result = await handleProposalCallback(supabase, 'qualcosa:non:valido');
    expect(result).toBeNull();
  });

  it('segnala se la proposta non esiste', async () => {
    const supabase = fakeSupabase([{ data: null, error: null }]);
    const result = await handleProposalCallback(supabase, 'proposal:1:approve');
    expect(result?.text).toContain('Proposta non trovata');
  });

  it('segnala se la proposta è già stata gestita', async () => {
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'applied' }, error: null },
    ]);
    const result = await handleProposalCallback(supabase, 'proposal:1:approve');
    expect(result?.text).toContain('già stata gestita');
  });

  it('rifiuta una proposta pending e aggiorna lo stato', async () => {
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
    ]);
    const result = await handleProposalCallback(supabase, 'proposal:1:reject');
    expect(result).toEqual({ chatId: 210039451, text: '❌ Proposta rifiutata: Prodotto A' });
  });

  it('applica una proposta approvata e aggiorna proposals + change_log', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockResolvedValue(undefined);
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleProposalCallback(supabase, 'proposal:1:approve');

    expect(applyProposal).toHaveBeenCalledWith('access-1', 'AAA', 'price', '18.00');
    expect(result).toEqual({
      chatId: 210039451,
      text: '✅ Applicato: Prodotto A — price aggiornato a 18.00',
    });
  });

  it('segnala un fallimento se applyProposal lancia un errore', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'rt-1',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(applyProposal).mockRejectedValue(new Error('eBay ha rifiutato la modifica'));
    const supabase = fakeSupabase([
      { data: { id: 1, listing_id: 10, field: 'price', proposed_value: '18.00', current_value: '20.00', status: 'pending' }, error: null },
      { data: { id: 10, ebay_item_id: 'AAA', chat_id: 210039451, title: 'Prodotto A' }, error: null },
      { data: { refresh_token: 'rt-1' }, error: null },
    ]);

    const result = await handleProposalCallback(supabase, 'proposal:1:approve');

    expect(result?.text).toContain('eBay ha rifiutato la modifica');
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/callbackHandler.test.ts`
Expected: FAIL — `Cannot find module '@/lib/callbackHandler'`

- [ ] **Step 4: Implementa `src/lib/callbackHandler.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { refreshAccessToken } from './ebayOAuth';
import { applyProposal } from './ebayRevise';

export interface CallbackResult {
  chatId: number;
  text: string;
}

export async function handleProposalCallback(
  supabase: SupabaseClient,
  callbackData: string
): Promise<CallbackResult | null> {
  const match = callbackData.match(/^proposal:(\d+):(approve|reject)$/);
  if (!match) {
    return null;
  }
  const proposalId = Number(match[1]);
  const action = match[2];

  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, listing_id, field, proposed_value, current_value, status')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal) {
    return { chatId: 0, text: 'Proposta non trovata.' };
  }
  if (proposal.status !== 'pending') {
    return { chatId: 0, text: `Questa proposta è già stata gestita (stato: ${proposal.status}).` };
  }

  const { data: listing } = await supabase
    .from('watched_listings')
    .select('id, ebay_item_id, chat_id, title')
    .eq('id', proposal.listing_id)
    .maybeSingle();

  if (!listing) {
    return { chatId: 0, text: 'Prodotto associato non trovato.' };
  }

  if (action === 'reject') {
    await supabase.from('proposals').update({ status: 'rejected' }).eq('id', proposalId);
    return { chatId: listing.chat_id, text: `❌ Proposta rifiutata: ${listing.title}` };
  }

  const { data: connection } = await supabase
    .from('ebay_connection')
    .select('refresh_token')
    .eq('chat_id', listing.chat_id)
    .maybeSingle();

  if (!connection?.refresh_token) {
    return { chatId: listing.chat_id, text: 'Nessun account eBay collegato, impossibile applicare la modifica.' };
  }

  try {
    const tokens = await refreshAccessToken(connection.refresh_token);
    await applyProposal(tokens.accessToken, listing.ebay_item_id, proposal.field, proposal.proposed_value);
    await supabase.from('proposals').update({ status: 'applied' }).eq('id', proposalId);
    await supabase.from('change_log').insert({
      listing_id: proposal.listing_id,
      proposal_id: proposalId,
      field: proposal.field,
      previous_value: proposal.current_value,
      new_value: proposal.proposed_value,
    });
    return {
      chatId: listing.chat_id,
      text: `✅ Applicato: ${listing.title} — ${proposal.field} aggiornato a ${proposal.proposed_value}`,
    };
  } catch (err) {
    await supabase.from('proposals').update({ status: 'failed' }).eq('id', proposalId);
    return { chatId: listing.chat_id, text: `⚠️ Errore nell'applicare la modifica: ${(err as Error).message}` };
  }
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/callbackHandler.test.ts`
Expected: PASS (6 test passed)

- [ ] **Step 6: Esegui l'intera suite**

Run: `npm test`
Expected: tutti i test passano

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0005_change_log.sql src/lib/callbackHandler.ts tests/lib/callbackHandler.test.ts
git commit -m "feat: handle proposal approval/rejection callbacks"
```

---

### Task 8: Collegare i callback_query alla route webhook

**Files:**
- Modify: `src/app/api/telegram/webhook/route.ts`
- Test: `tests/app/api/telegram/webhook.test.ts`

**Interfaces:**
- Consumes: `answerCallbackQuery` da `@/lib/telegram` (Task 1); `handleProposalCallback` da `@/lib/callbackHandler` (Task 7); `isAuthorized` da `@/lib/commandRouter`
- Produces: la route `POST /api/telegram/webhook` ora gestisce anche `update.callback_query`

- [ ] **Step 1: Scrivi i test per la gestione dei callback_query**

In `tests/app/api/telegram/webhook.test.ts`, il mock esistente di `@/lib/telegram` sovrascrive solo `sendMessage`, lasciando `answerCallbackQuery` con l'implementazione reale — questo farebbe partire una vera chiamata `fetch` non appena la route la invoca. Sostituisci il mock esistente:

```ts
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});
```

con:

```ts
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn(), answerCallbackQuery: vi.fn() };
});

vi.mock('@/lib/callbackHandler', () => ({ handleProposalCallback: vi.fn() }));
```

Aggiungi questi import sotto gli altri import esistenti:

```ts
import { answerCallbackQuery } from '@/lib/telegram';
import { handleProposalCallback } from '@/lib/callbackHandler';
```

Nel `beforeEach` esistente, aggiungi (accanto al reset di `sendMessage`) e assicurati che `TELEGRAM_OWNER_CHAT_ID` sia impostato a `'100'` (già presente nei test esistenti del router, verifica sia coerente in questo file):

```ts
    vi.mocked(answerCallbackQuery).mockReset().mockResolvedValue(undefined);
    process.env.TELEGRAM_OWNER_CHAT_ID = '100';
```

Aggiungi questi test nel `describe('POST /api/telegram/webhook', ...)`, dopo i test esistenti:

```ts
  it('gestisce un callback_query: risponde subito e poi manda il messaggio', async () => {
    vi.mocked(handleProposalCallback).mockResolvedValue({ chatId: 100, text: 'Fatto' });
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 100 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(handleProposalCallback).toHaveBeenCalledWith({}, 'proposal:1:approve');
    expect(sendMessage).toHaveBeenCalledWith(100, 'Fatto');
  });

  it('ignora i callback_query da chat non autorizzate', async () => {
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 999 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(handleProposalCallback).not.toHaveBeenCalled();
  });

  it('non fallisce se handleProposalCallback lancia un errore', async () => {
    vi.mocked(handleProposalCallback).mockRejectedValue(new Error('errore interno'));
    const req = makeRequest(
      { callback_query: { id: 'cbq-1', data: 'proposal:1:approve', from: { id: 100 } } },
      'super-secret'
    );

    const res = await POST(req);

    expect(res.status).toBe(200);
  });
```

Nota: questi test assumono `TELEGRAM_OWNER_CHAT_ID=100` — aggiungi questa riga nel `beforeEach` esistente del file, se non già presente: `process.env.TELEGRAM_OWNER_CHAT_ID = '100';`

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/app/api/telegram/webhook.test.ts`
Expected: FAIL — i callback_query non vengono gestiti, `handleProposalCallback` mai chiamato

- [ ] **Step 3: Modifica `src/app/api/telegram/webhook/route.ts`**

Sostituisci il contenuto del file con:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { routeCommand, isAuthorized } from '@/lib/commandRouter';
import { sendMessage, answerCallbackQuery, verifyWebhookSecret, TelegramUpdate } from '@/lib/telegram';
import { handleProposalCallback } from '@/lib/callbackHandler';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!verifyWebhookSecret(secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (err) {
    console.error('Telegram webhook: corpo della richiesta non valido', err);
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const callbackQuery = update.callback_query;
  if (callbackQuery?.data && callbackQuery.from?.id) {
    await answerCallbackQuery(callbackQuery.id);
    if (isAuthorized(callbackQuery.from.id)) {
      try {
        const supabase = getSupabaseClient();
        const result = await handleProposalCallback(supabase, callbackQuery.data);
        if (result) {
          await sendMessage(result.chatId, result.text);
        }
      } catch (err) {
        console.error('Telegram webhook: errore nella gestione del callback', err);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  try {
    const supabase = getSupabaseClient();
    const result = await routeCommand(supabase, message.chat.id, message.text);
    await sendMessage(message.chat.id, result.text);
  } catch (err) {
    console.error('Telegram webhook: errore durante la gestione del comando', err);
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/app/api/telegram/webhook.test.ts`
Expected: PASS (9 test passed)

- [ ] **Step 5: Esegui l'intera suite e la build**

Run: `npm test && npm run build`
Expected: tutti i test passano, build completata senza errori

- [ ] **Step 6: Commit**

```bash
git add src/app/api/telegram/webhook/route.ts tests/app/api/telegram/webhook.test.ts
git commit -m "feat: wire proposal approval callbacks into the Telegram webhook"
```

---

### Task 9: Cron giornaliero (raccolta + analisi + recap automatico)

**Files:**
- Create: `src/lib/recap.ts`
- Create: `src/app/api/cron/daily-analysis/route.ts`
- Create: `vercel.json`
- Test: `tests/lib/recap.test.ts`
- Test: `tests/app/api/cron/daily-analysis.test.ts`

**Interfaces:**
- Consumes: `collectDailyMetrics` da `@/lib/metricsCollector` (Task 3); `generateAndSendProposals` da `@/lib/proposalGenerator` (Task 5); `sendMessage` da `@/lib/telegram`; `ListingSnapshot` da `@/lib/analysisEngine`
- Produces: `buildDailySummaryText(listings: ListingRecapData[]): string`, `ListingRecapData = { title: string; today: { watchCount: number; quantitySold: number; revenue: number }; avgWatch: number; informationalNotes: string[] }` da `@/lib/recap`. Endpoint `GET /api/cron/daily-analysis`. Usato anche dal recap manuale (Task 10).

- [ ] **Step 1: Scrivi i test per `buildDailySummaryText`**

```ts
// tests/lib/recap.test.ts
import { describe, it, expect } from 'vitest';
import { buildDailySummaryText, type ListingRecapData } from '@/lib/recap';

describe('buildDailySummaryText', () => {
  it('segnala se non ci sono prodotti', () => {
    expect(buildDailySummaryText([])).toBe('Nessun prodotto monitorato con dati sufficienti per il recap di oggi.');
  });

  it('include metriche e trend per ogni prodotto', () => {
    const listings: ListingRecapData[] = [
      { title: 'Prodotto A', today: { watchCount: 12, quantitySold: 1, revenue: 20 }, avgWatch: 10, informationalNotes: [] },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('Prodotto A');
    expect(text).toContain('12 watcher');
    expect(text).toContain('+20%');
    expect(text).toContain('1 venduti');
  });

  it('include le note informative sotto il prodotto', () => {
    const listings: ListingRecapData[] = [
      {
        title: 'Prodotto B',
        today: { watchCount: 1, quantitySold: 0, revenue: 0 },
        avgWatch: 10,
        informationalNotes: ['possibile categoria da rivedere'],
      },
    ];
    const text = buildDailySummaryText(listings);
    expect(text).toContain('⚠️ possibile categoria da rivedere');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/recap.test.ts`
Expected: FAIL — `Cannot find module '@/lib/recap'`

- [ ] **Step 3: Implementa `src/lib/recap.ts`**

```ts
export interface ListingRecapData {
  title: string;
  today: { watchCount: number; quantitySold: number; revenue: number };
  avgWatch: number;
  informationalNotes: string[];
}

export function buildDailySummaryText(listings: ListingRecapData[]): string {
  if (listings.length === 0) {
    return 'Nessun prodotto monitorato con dati sufficienti per il recap di oggi.';
  }

  const lines = listings.map((listing) => {
    const trend =
      listing.avgWatch > 0
        ? `${listing.today.watchCount >= listing.avgWatch ? '+' : ''}${Math.round(
            ((listing.today.watchCount - listing.avgWatch) / listing.avgWatch) * 100
          )}%`
        : 'n/d';
    const base = `📊 ${listing.title} — oggi: ${listing.today.watchCount} watcher (${trend} vs media), ${listing.today.quantitySold} venduti`;
    const notes = listing.informationalNotes.map((note) => `   ⚠️ ${note}`).join('\n');
    return notes ? `${base}\n${notes}` : base;
  });

  return `Recap giornaliero:\n\n${lines.join('\n\n')}`;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/recap.test.ts`
Expected: PASS (3 test passed)

- [ ] **Step 5: Scrivi i test per la route del cron**

```ts
// tests/app/api/cron/daily-analysis.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeSupabase } from '../../../helpers/fakeSupabase';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/metricsCollector', () => ({ collectDailyMetrics: vi.fn() }));
vi.mock('@/lib/proposalGenerator', () => ({ generateAndSendProposals: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { getSupabaseClient } from '@/lib/supabase';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import { sendMessage } from '@/lib/telegram';
import { GET } from '@/app/api/cron/daily-analysis/route';

function makeRequest(authHeader: string | null) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  return new NextRequest('http://localhost/api/cron/daily-analysis', { headers });
}

describe('GET /api/cron/daily-analysis', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.TELEGRAM_OWNER_CHAT_ID = '210039451';
    vi.mocked(getSupabaseClient).mockReset();
    vi.mocked(collectDailyMetrics).mockReset();
    vi.mocked(generateAndSendProposals).mockReset();
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
  });

  it('ritorna 401 se il secret non corrisponde', async () => {
    const res = await GET(makeRequest('Bearer sbagliato'));
    expect(res.status).toBe(401);
    expect(collectDailyMetrics).not.toHaveBeenCalled();
  });

  it('raccoglie le metriche, genera le proposte e manda il recap', async () => {
    vi.mocked(collectDailyMetrics).mockResolvedValue({ collected: 1, errors: [] });
    vi.mocked(generateAndSendProposals).mockResolvedValue({ sent: 1, informational: [] });
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A' }], error: null }, // watched_listings attivi
      {
        data: [
          { metric_date: '2026-07-01', watch_count: 10, quantity_sold: 1, revenue: 20, price: 18, ad_rate_percent: null },
        ],
        error: null,
      }, // storico daily_metrics del prodotto 1
    ]);
    vi.mocked(getSupabaseClient).mockReturnValue(supabase);

    const res = await GET(makeRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    expect(collectDailyMetrics).toHaveBeenCalledWith(supabase, 210039451);
    expect(sendMessage).toHaveBeenCalledWith(210039451, expect.stringContaining('Recap giornaliero'));
  });
});
```

Nota sul path dell'helper: questo file di test vive in `tests/app/api/cron/`, tre livelli sotto `tests/`, quindi l'import di `createFakeSupabase` usa `../../../helpers/fakeSupabase` (non `../../helpers/...` come nei test a due livelli di profondità).

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/app/api/cron/daily-analysis.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/cron/daily-analysis/route'`

- [ ] **Step 7: Implementa `src/app/api/cron/daily-analysis/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { collectDailyMetrics } from '@/lib/metricsCollector';
import { generateAndSendProposals } from '@/lib/proposalGenerator';
import { sendMessage } from '@/lib/telegram';
import { buildDailySummaryText, type ListingRecapData } from '@/lib/recap';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const chatId = Number(process.env.TELEGRAM_OWNER_CHAT_ID);
  const supabase = getSupabaseClient();

  await collectDailyMetrics(supabase, chatId);

  const { data: listings } = await supabase
    .from('watched_listings')
    .select('id, title')
    .eq('chat_id', chatId)
    .eq('status', 'active');

  const recapData: ListingRecapData[] = [];

  for (const listing of listings ?? []) {
    const { data: history } = await supabase
      .from('daily_metrics')
      .select('metric_date, watch_count, quantity_sold, revenue, price, ad_rate_percent')
      .eq('listing_id', listing.id)
      .order('metric_date', { ascending: true });

    const rows = history ?? [];
    const today = rows[rows.length - 1];
    if (!today) continue;
    const pastRows = rows.slice(0, -1);
    const avgWatch =
      pastRows.length > 0 ? pastRows.reduce((sum: number, r: any) => sum + r.watch_count, 0) / pastRows.length : 0;

    const snapshot = {
      listingId: listing.id,
      title: listing.title,
      categoryId: null,
      today: {
        metricDate: today.metric_date,
        watchCount: today.watch_count,
        quantitySold: today.quantity_sold,
        revenue: today.revenue,
        price: today.price,
        adRatePercent: today.ad_rate_percent,
      },
      history: pastRows.map((r: any) => ({
        metricDate: r.metric_date,
        watchCount: r.watch_count,
        quantitySold: r.quantity_sold,
        revenue: r.revenue,
        price: r.price,
        adRatePercent: r.ad_rate_percent,
      })),
    };

    const { informational } = await generateAndSendProposals(supabase, chatId, listing.id, snapshot);

    recapData.push({
      title: listing.title,
      today: { watchCount: today.watch_count, quantitySold: today.quantity_sold, revenue: today.revenue },
      avgWatch,
      informationalNotes: informational,
    });
  }

  await sendMessage(chatId, buildDailySummaryText(recapData));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Esegui il test e verifica che passi**

Run: `npm test -- tests/app/api/cron/daily-analysis.test.ts`
Expected: PASS (2 test passed)

- [ ] **Step 9: Crea `vercel.json` per schedulare il cron**

```json
{
  "crons": [
    {
      "path": "/api/cron/daily-analysis",
      "schedule": "0 19 * * *"
    }
  ]
}
```

- [ ] **Step 10: Esegui l'intera suite e la build**

Run: `npm test && npm run build`
Expected: tutti i test passano, build completata senza errori

- [ ] **Step 11: Commit**

```bash
git add src/lib/recap.ts src/app/api/cron/daily-analysis/route.ts vercel.json tests/lib/recap.test.ts tests/app/api/cron/daily-analysis.test.ts
git commit -m "feat: add daily cron for metrics, proposals and automatic recap"
```

---

### Task 10: Comando manuale `/recap <id>`

**Files:**
- Create: `src/lib/commands/recap.ts`
- Modify: `src/lib/commandRouter.ts`
- Test: `tests/lib/commands/recap.test.ts`
- Test: `tests/lib/commandRouter.test.ts`

**Interfaces:**
- Consumes: `buildDailySummaryText`, `ListingRecapData` da `@/lib/recap` (Task 9); tabelle `watched_listings`, `daily_metrics`
- Produces: `handleRecap: CommandHandler` da `@/lib/commands/recap`, registrato come comando `/recap <id>`

- [ ] **Step 1: Scrivi i test per `handleRecap`**

```ts
// tests/lib/commands/recap.test.ts
import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handleRecap } from '@/lib/commands/recap';

describe('handleRecap', () => {
  it('chiede un id valido se gli argomenti non sono un numero', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleRecap({ supabase, chatId: 1, args: 'abc' });
    expect(result.text).toContain('Uso: /recap <id>');
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handleRecap({ supabase, chatId: 1, args: '99' });
    expect(result.text).toContain('Nessun prodotto trovato con id 99');
  });

  it('mostra il recap con lo storico disponibile', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 5, title: 'Prodotto A' }, error: null },
      {
        data: [
          { metric_date: '2026-07-01', watch_count: 10, quantity_sold: 0, revenue: 0 },
          { metric_date: '2026-07-02', watch_count: 12, quantity_sold: 1, revenue: 20 },
        ],
        error: null,
      },
    ]);

    const result = await handleRecap({ supabase, chatId: 1, args: '5' });

    expect(result.text).toContain('Prodotto A');
    expect(result.text).toContain('12 watcher');
  });

  it('segnala se non ci sono ancora metriche raccolte per il prodotto', async () => {
    const supabase = createFakeSupabase([
      { data: { id: 5, title: 'Prodotto A' }, error: null },
      { data: [], error: null },
    ]);

    const result = await handleRecap({ supabase, chatId: 1, args: '5' });

    expect(result.text).toContain('Nessuna metrica ancora raccolta per questo prodotto');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/commands/recap.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commands/recap'`

- [ ] **Step 3: Implementa `src/lib/commands/recap.ts`**

```ts
import type { CommandHandler } from './types';
import { buildDailySummaryText } from '@/lib/recap';

export const handleRecap: CommandHandler = async ({ supabase, chatId, args }) => {
  const id = Number(args.trim());
  if (!Number.isInteger(id)) {
    return { text: 'Uso: /recap <id>' };
  }

  const { data: listing } = await supabase
    .from('watched_listings')
    .select('id, title')
    .eq('id', id)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!listing) {
    return { text: `Nessun prodotto trovato con id ${id}.` };
  }

  const { data: history } = await supabase
    .from('daily_metrics')
    .select('metric_date, watch_count, quantity_sold, revenue')
    .eq('listing_id', id)
    .order('metric_date', { ascending: true });

  const rows = history ?? [];
  if (rows.length === 0) {
    return { text: `Nessuna metrica ancora raccolta per questo prodotto (${listing.title}).` };
  }

  const today = rows[rows.length - 1];
  const pastRows = rows.slice(0, -1);
  const avgWatch =
    pastRows.length > 0 ? pastRows.reduce((sum: number, r: any) => sum + r.watch_count, 0) / pastRows.length : 0;

  const text = buildDailySummaryText([
    {
      title: listing.title,
      today: { watchCount: today.watch_count, quantitySold: today.quantity_sold, revenue: today.revenue },
      avgWatch,
      informationalNotes: [],
    },
  ]);

  return { text };
};
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/commands/recap.test.ts`
Expected: PASS (4 test passed)

- [ ] **Step 5: Registra il comando nel router**

In `src/lib/commandRouter.ts`, aggiungi l'import sotto gli altri import di comandi:

```ts
import { handleRecap } from './commands/recap';
```

Sostituisci il blocco `HELP_TEXT` esistente:

```ts
const HELP_TEXT = `Comandi disponibili:
/addproduct <link o ID eBay> - inizia a monitorare un prodotto
/listproducts - elenco prodotti monitorati
/pause <id> - metti in pausa un prodotto
/resume <id> - riprendi il monitoraggio
/connectebay - collega il tuo account eBay
/scanproducts - aggiunge automaticamente le inserzioni attive del tuo account eBay collegato
/help - questo messaggio`;
```

con:

```ts
const HELP_TEXT = `Comandi disponibili:
/addproduct <link o ID eBay> - inizia a monitorare un prodotto
/listproducts - elenco prodotti monitorati
/pause <id> - metti in pausa un prodotto
/resume <id> - riprendi il monitoraggio
/connectebay - collega il tuo account eBay
/scanproducts - aggiunge automaticamente le inserzioni attive del tuo account eBay collegato
/recap <id> - riepilogo di un prodotto monitorato
/help - questo messaggio`;
```

Sostituisci il dizionario `COMMANDS` esistente:

```ts
const COMMANDS: Record<string, (ctx: CommandContext) => Promise<CommandResult>> = {
  '/start': async () => ({ text: 'Bot attivato. Usa /addproduct <link o ID eBay> per iniziare a monitorare un prodotto.' }),
  '/addproduct': handleAddProduct,
  '/listproducts': handleListProducts,
  '/pause': handlePause,
  '/resume': handleResume,
  '/connectebay': handleConnectEbay,
  '/scanproducts': handleScanProducts,
  '/help': async () => ({ text: HELP_TEXT }),
};
```

con:

```ts
const COMMANDS: Record<string, (ctx: CommandContext) => Promise<CommandResult>> = {
  '/start': async () => ({ text: 'Bot attivato. Usa /addproduct <link o ID eBay> per iniziare a monitorare un prodotto.' }),
  '/addproduct': handleAddProduct,
  '/listproducts': handleListProducts,
  '/pause': handlePause,
  '/resume': handleResume,
  '/connectebay': handleConnectEbay,
  '/scanproducts': handleScanProducts,
  '/recap': handleRecap,
  '/help': async () => ({ text: HELP_TEXT }),
};
```

Aggiungi in `tests/lib/commandRouter.test.ts`, dopo il test esistente `dispatcha /scanproducts al comando corretto`:

```ts
  it('dispatcha /recap al comando corretto', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await routeCommand(supabase, 100, '/recap 5');
    expect(result.text).toContain('Nessun prodotto trovato con id 5');
  });
```

Aggiorna anche il test `risponde a /help con la lista dei comandi` aggiungendo:

```ts
    expect(result.text).toContain('/recap');
```

- [ ] **Step 6: Esegui l'intera suite e la build**

Run: `npm test && npm run build`
Expected: tutti i test passano, build completata senza errori

- [ ] **Step 7: Commit**

```bash
git add src/lib/commands/recap.ts src/lib/commandRouter.ts tests/lib/commands/recap.test.ts tests/lib/commandRouter.test.ts
git commit -m "feat: add manual /recap command for single-listing summaries"
```
