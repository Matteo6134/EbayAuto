# eBay Agent — Piano 1: Fondamenta + Bot Telegram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire le fondamenta del progetto (Next.js + Supabase + Vitest) e un bot Telegram funzionante che permette di aggiungere/elencare/mettere in pausa i prodotti eBay da monitorare, validandoli tramite l'API pubblica eBay (Browse API, nessuna scrittura).

**Architecture:** App Next.js (App Router, TypeScript) deployata su Vercel con un unico endpoint webhook Telegram (`/api/telegram/webhook`). Lo stato (prodotti monitorati) vive su Supabase (Postgres). Ogni comando Telegram è una funzione pura testabile isolatamente; il router valida l'autorizzazione e dispatcha al comando giusto.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (`@supabase/supabase-js`), Vitest per i test, nessun framework bot (chiamate dirette alla Telegram Bot API via `fetch`).

## Nota sullo scope

Questo è il **Piano 1 di 2** derivati dalla spec [`docs/superpowers/specs/2026-07-06-ebay-listing-agent-design.md`](../specs/2026-07-06-ebay-listing-agent-design.md). Copre solo le fondamenta e la gestione della watchlist via Telegram (nessuna scrittura su eBay, nessuna analisi, nessun cron). Il **Piano 2** (cron di analisi, proposte, approvazione, applicazione modifiche, recap giornaliero) verrà scritto a parte, dopo che: (a) questo piano è stato implementato e testato, e (b) l'app eBay Developer dell'utente è stata approvata e collegata via OAuth (necessaria per le API di scrittura/Marketing/Analytics).

## Global Constraints

- Il bot risponde solo al chat_id autorizzato in `TELEGRAM_OWNER_CHAT_ID`; qualunque altro chat riceve un rifiuto esplicito, nessun comando viene eseguito.
- Tutti i testi inviati dal bot all'utente sono in italiano.
- Nessuna scrittura sull'account eBay in questo piano: solo lettura pubblica via Browse API (`client_credentials` grant) per validare un'inserzione. Scrittura/OAuth utente arrivano nel Piano 2.
- Stack fissato: Next.js (App Router, TypeScript) + Supabase (Postgres) + Vitest. Vercel come target di deploy.
- Vengono monitorati solo i prodotti aggiunti esplicitamente con `/addproduct`; nessuna scansione automatica dell'intero catalogo eBay.

---

### Task 1: Scaffold progetto (Next.js + TypeScript + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nessuna (primo task)
- Produces: alias TypeScript `@/*` → `src/*` usato da tutti i task successivi; script npm `test`, `dev`, `build`

- [ ] **Step 1: Crea `package.json`**

```json
{
  "name": "ebay-agent",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Crea `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Crea `next.config.js`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
```

- [ ] **Step 4: Crea `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Crea `.env.example`**

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_OWNER_CHAT_ID=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
```

- [ ] **Step 6: Crea `.gitignore`**

```
node_modules/
.next/
.env
.env.local
```

- [ ] **Step 7: Crea `src/app/layout.tsx`**

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Crea `src/app/page.tsx`**

```tsx
export default function Home() {
  return <p>eBay Listing Agent</p>;
}
```

- [ ] **Step 9: Scrivi uno smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('vitest è configurato correttamente', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: Installa le dipendenze e verifica che il test passi**

Run: `npm install && npm test`
Expected: tutte le dipendenze si installano senza errori, `tests/smoke.test.ts` passa (1 test passed).

- [ ] **Step 11: Verifica che il progetto compili**

Run: `npm run build`
Expected: build Next.js completata senza errori (route `/` statica).

- [ ] **Step 12: Commit**

```bash
git add package.json tsconfig.json next.config.js vitest.config.ts .env.example .gitignore src/app/layout.tsx src/app/page.tsx tests/smoke.test.ts package-lock.json
git commit -m "chore: scaffold Next.js + TypeScript + Vitest project"
```

---

### Task 2: Schema Supabase + client wrapper

**Files:**
- Create: `supabase/migrations/0001_watched_listings.sql`
- Create: `src/lib/supabase.ts`
- Test: `tests/lib/supabase.test.ts`

**Interfaces:**
- Consumes: nessuna
- Produces: `getSupabaseClient(): SupabaseClient` da `@/lib/supabase`, usato da tutti i comandi (Task 5) e dalla route webhook (Task 6). Tabella `watched_listings(id, ebay_item_id, title, category_id, chat_id, status, created_at)`.

- [ ] **Step 1: Crea la migrazione SQL**

```sql
-- supabase/migrations/0001_watched_listings.sql
create table if not exists watched_listings (
  id bigint generated always as identity primary key,
  ebay_item_id text not null unique,
  title text not null,
  category_id text,
  chat_id bigint not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);

create index if not exists watched_listings_chat_id_idx on watched_listings (chat_id);
```

- [ ] **Step 2: Scrivi il test per `getSupabaseClient` (caso di errore)**

```ts
// tests/lib/supabase.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('getSupabaseClient', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it('lancia un errore se mancano le variabili d\'ambiente', async () => {
    const { getSupabaseClient } = await import('@/lib/supabase');
    expect(() => getSupabaseClient()).toThrow('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti');
  });

  it('crea un client quando le variabili sono presenti', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const { getSupabaseClient } = await import('@/lib/supabase');
    const client = getSupabaseClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/supabase.test.ts`
Expected: FAIL — `Cannot find module '@/lib/supabase'`

- [ ] **Step 4: Implementa `src/lib/supabase.ts`**

```ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti");
  }
  return createClient(url, key);
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/supabase.test.ts`
Expected: PASS (2 test passed)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_watched_listings.sql src/lib/supabase.ts tests/lib/supabase.test.ts
git commit -m "feat: add Supabase schema and client wrapper"
```

---

### Task 3: Integrazione eBay (validazione inserzione via Browse API)

**Files:**
- Create: `src/lib/ebay.ts`
- Test: `tests/lib/ebay.test.ts`

**Interfaces:**
- Consumes: nessuna
- Produces: `extractItemId(input: string): string | null`, `getAppAccessToken(): Promise<string>`, `fetchListingSummary(itemId: string): Promise<EbayListingSummary>` da `@/lib/ebay`, dove `EbayListingSummary = { itemId: string; title: string; categoryId: string; categoryName: string; price: number; currency: string }`. Usato dal comando `/addproduct` (Task 5).

- [ ] **Step 1: Scrivi i test per `extractItemId`**

```ts
// tests/lib/ebay.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractItemId } from '@/lib/ebay';

describe('extractItemId', () => {
  it('riconosce un ID numerico diretto', () => {
    expect(extractItemId('123456789012')).toBe('123456789012');
  });

  it('estrae l\'ID da un URL eBay', () => {
    expect(extractItemId('https://www.ebay.it/itm/123456789012')).toBe('123456789012');
  });

  it('estrae l\'ID da un URL eBay con slug', () => {
    expect(extractItemId('https://www.ebay.it/itm/Titolo-prodotto/123456789012')).toBe('123456789012');
  });

  it('ritorna null per un input non valido', () => {
    expect(extractItemId('non un id valido')).toBeNull();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/ebay.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ebay'`

- [ ] **Step 3: Implementa `extractItemId` in `src/lib/ebay.ts`**

```ts
export interface EbayListingSummary {
  itemId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  price: number;
  currency: string;
}

export function extractItemId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{9,15}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/);
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/ebay.test.ts`
Expected: PASS (4 test passed)

- [ ] **Step 5: Scrivi i test per `getAppAccessToken` e `fetchListingSummary` (con `fetch` mockato)**

```ts
// aggiungi in tests/lib/ebay.test.ts, sotto il blocco precedente

describe('getAppAccessToken / fetchListingSummary', () => {
  beforeEach(() => {
    process.env.EBAY_CLIENT_ID = 'client-id';
    process.env.EBAY_CLIENT_SECRET = 'client-secret';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ottiene un token e lo usa per recuperare l\'inserzione', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: 'Prodotto di test',
          categoryId: '12345',
          categoryPath: 'Elettronica|Test',
          price: { value: '19.99', currency: 'EUR' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchListingSummary } = await import('@/lib/ebay');
    const summary = await fetchListingSummary('123456789012');

    expect(summary).toEqual({
      itemId: '123456789012',
      title: 'Prodotto di test',
      categoryId: '12345',
      categoryName: 'Elettronica|Test',
      price: 19.99,
      currency: 'EUR',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lancia un errore se eBay non trova l\'inserzione', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchListingSummary } = await import('@/lib/ebay');
    await expect(fetchListingSummary('000000000000')).rejects.toThrow(
      "eBay non ha trovato l'inserzione 000000000000 (status 404)"
    );
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/ebay.test.ts`
Expected: FAIL — `fetchListingSummary` non esiste ancora

- [ ] **Step 7: Implementa `getAppAccessToken` e `fetchListingSummary` in `src/lib/ebay.ts`**

```ts
// aggiungi in src/lib/ebay.ts, sotto extractItemId

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAppAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('EBAY_CLIENT_ID o EBAY_CLIENT_SECRET mancanti');
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) {
    throw new Error(`Impossibile ottenere il token eBay (status ${res.status})`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

export async function fetchListingSummary(itemId: string): Promise<EbayListingSummary> {
  const token = await getAppAccessToken();
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${itemId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_IT',
      },
    }
  );
  if (!res.ok) {
    throw new Error(`eBay non ha trovato l'inserzione ${itemId} (status ${res.status})`);
  }
  const data = await res.json();
  return {
    itemId,
    title: data.title,
    categoryId: data.categoryId,
    categoryName: data.categoryPath ?? data.categoryId,
    price: Number(data.price?.value ?? 0),
    currency: data.price?.currency ?? 'EUR',
  };
}
```

- [ ] **Step 8: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/ebay.test.ts`
Expected: PASS (6 test passed)

- [ ] **Step 9: Commit**

```bash
git add src/lib/ebay.ts tests/lib/ebay.test.ts
git commit -m "feat: add eBay Browse API integration for listing validation"
```

---

### Task 4: Client Telegram

**Files:**
- Create: `src/lib/telegram.ts`
- Test: `tests/lib/telegram.test.ts`

**Interfaces:**
- Consumes: nessuna
- Produces: `sendMessage(chatId: number, text: string): Promise<void>`, `verifyWebhookSecret(headerValue: string | null): boolean`, tipi `TelegramUpdate`, `TelegramMessage`, `TelegramCallbackQuery` da `@/lib/telegram`. Usati dalla route webhook (Task 6). Nota: `answerCallbackQuery` (per i bottoni di approvazione) non è incluso in questo piano — verrà aggiunto nel Piano 2 insieme al primo comando che lo usa davvero.

- [ ] **Step 1: Scrivi i test per `sendMessage` e `verifyWebhookSecret`**

```ts
// tests/lib/telegram.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('telegram client', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'super-secret';
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invia un messaggio con il testo corretto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { sendMessage } = await import('@/lib/telegram');
    await sendMessage(42, 'ciao');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat_id: 42, text: 'ciao' }),
      })
    );
  });

  it('lancia un errore se Telegram risponde con errore', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    const { sendMessage } = await import('@/lib/telegram');
    await expect(sendMessage(42, 'ciao')).rejects.toThrow('Telegram sendMessage fallita (status 400)');
  });

  it('verifica correttamente il secret del webhook', async () => {
    const { verifyWebhookSecret } = await import('@/lib/telegram');
    expect(verifyWebhookSecret('super-secret')).toBe(true);
    expect(verifyWebhookSecret('sbagliato')).toBe(false);
    expect(verifyWebhookSecret(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/telegram.test.ts`
Expected: FAIL — `Cannot find module '@/lib/telegram'`

- [ ] **Step 3: Implementa `src/lib/telegram.ts`**

```ts
export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from: { id: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN mancante');
  }
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendMessage(chatId: number, text: string): Promise<void> {
  const res = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    throw new Error(`Telegram sendMessage fallita (status ${res.status})`);
  }
}

export function verifyWebhookSecret(headerValue: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  return Boolean(expected) && headerValue === expected;
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/telegram.test.ts`
Expected: PASS (3 test passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/telegram.ts tests/lib/telegram.test.ts
git commit -m "feat: add Telegram Bot API client"
```

---

### Task 5: Comandi Telegram + router

**Files:**
- Create: `src/lib/commands/types.ts`
- Create: `src/lib/commands/addproduct.ts`
- Create: `src/lib/commands/listproducts.ts`
- Create: `src/lib/commands/pauseresume.ts`
- Create: `src/lib/commandRouter.ts`
- Test: `tests/helpers/fakeSupabase.ts`
- Test: `tests/lib/commands/addproduct.test.ts`
- Test: `tests/lib/commands/listproducts.test.ts`
- Test: `tests/lib/commands/pauseresume.test.ts`
- Test: `tests/lib/commandRouter.test.ts`

**Interfaces:**
- Consumes: `EbayListingSummary`, `fetchListingSummary`, `extractItemId` da `@/lib/ebay` (Task 3); `SupabaseClient` da `@supabase/supabase-js` (Task 2, tabella `watched_listings`)
- Produces: `CommandContext = { supabase: SupabaseClient; chatId: number; args: string }`, `CommandResult = { text: string }`, `CommandHandler = (ctx: CommandContext) => Promise<CommandResult>` da `@/lib/commands/types`; `routeCommand(supabase: SupabaseClient, chatId: number, text: string): Promise<CommandResult>` e `isAuthorized(chatId: number): boolean` da `@/lib/commandRouter`. Usati dalla route webhook (Task 6).

- [ ] **Step 1: Crea l'helper di test `fakeSupabase`**

```ts
// tests/helpers/fakeSupabase.ts
export function createFakeSupabase(results: Array<{ data: any; error: any }>) {
  let i = 0;
  const next = () => results[Math.min(i++, results.length - 1)];
  const builder: any = {
    from: () => builder,
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    insert: () => builder,
    update: () => builder,
    maybeSingle: () => Promise.resolve(next()),
    single: () => Promise.resolve(next()),
    then: (resolve: (value: { data: any; error: any }) => void) => resolve(next()),
  };
  return builder;
}
```

- [ ] **Step 2: Crea i tipi condivisi dei comandi**

```ts
// src/lib/commands/types.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CommandContext {
  supabase: SupabaseClient;
  chatId: number;
  args: string;
}

export interface CommandResult {
  text: string;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;
```

- [ ] **Step 3: Scrivi i test per `/addproduct`**

```ts
// tests/lib/commands/addproduct.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';

vi.mock('@/lib/ebay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ebay')>();
  return { ...actual, fetchListingSummary: vi.fn() };
});

import { fetchListingSummary } from '@/lib/ebay';
import { handleAddProduct } from '@/lib/commands/addproduct';

describe('handleAddProduct', () => {
  beforeEach(() => {
    vi.mocked(fetchListingSummary).mockReset();
  });

  it('chiede un ID valido se gli argomenti non contengono un ID eBay', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: 'boh' });
    expect(result.text).toContain('Uso: /addproduct');
  });

  it('segnala se l\'inserzione non viene trovata su eBay', async () => {
    vi.mocked(fetchListingSummary).mockRejectedValue(new Error('eBay non ha trovato l\'inserzione 123456789012 (status 404)'));
    const supabase = createFakeSupabase([]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: '123456789012' });
    expect(result.text).toContain('Non sono riuscito a trovare l\'inserzione');
  });

  it('segnala se il prodotto è già monitorato', async () => {
    vi.mocked(fetchListingSummary).mockResolvedValue({
      itemId: '123456789012',
      title: 'Prodotto X',
      categoryId: '1',
      categoryName: 'Cat',
      price: 10,
      currency: 'EUR',
    });
    const supabase = createFakeSupabase([{ data: { id: 7 }, error: null }]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: '123456789012' });
    expect(result.text).toContain('è già monitorato');
  });

  it('aggiunge un nuovo prodotto e conferma', async () => {
    vi.mocked(fetchListingSummary).mockResolvedValue({
      itemId: '123456789012',
      title: 'Prodotto X',
      categoryId: '1',
      categoryName: 'Elettronica',
      price: 10,
      currency: 'EUR',
    });
    const supabase = createFakeSupabase([
      { data: null, error: null },
      { data: { id: 3 }, error: null },
    ]);
    const result = await handleAddProduct({ supabase, chatId: 1, args: '123456789012' });
    expect(result.text).toContain('Aggiunto ai prodotti monitorati (id 3)');
    expect(result.text).toContain('Prodotto X');
  });
});
```

- [ ] **Step 4: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/commands/addproduct.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commands/addproduct'`

- [ ] **Step 5: Implementa `src/lib/commands/addproduct.ts`**

```ts
import type { CommandHandler } from './types';
import { extractItemId, fetchListingSummary } from '@/lib/ebay';

export const handleAddProduct: CommandHandler = async ({ supabase, chatId, args }) => {
  const itemId = extractItemId(args);
  if (!itemId) {
    return { text: 'Uso: /addproduct <link o ID eBay>. Non ho riconosciuto un ID valido.' };
  }

  let listing;
  try {
    listing = await fetchListingSummary(itemId);
  } catch (err) {
    return { text: `Non sono riuscito a trovare l'inserzione: ${(err as Error).message}` };
  }

  const { data: existing } = await supabase
    .from('watched_listings')
    .select('id')
    .eq('ebay_item_id', itemId)
    .maybeSingle();

  if (existing) {
    return { text: `"${listing.title}" è già monitorato (id ${existing.id}).` };
  }

  const { data: inserted, error } = await supabase
    .from('watched_listings')
    .insert({
      ebay_item_id: itemId,
      title: listing.title,
      category_id: listing.categoryId,
      chat_id: chatId,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    return { text: `Errore nel salvare il prodotto: ${error.message}` };
  }

  return {
    text: `✅ Aggiunto ai prodotti monitorati (id ${inserted.id}):\n${listing.title}\nCategoria: ${listing.categoryName}\nPrezzo: ${listing.price} ${listing.currency}`,
  };
};
```

- [ ] **Step 6: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/commands/addproduct.test.ts`
Expected: PASS (4 test passed)

- [ ] **Step 7: Scrivi i test per `/listproducts`**

```ts
// tests/lib/commands/listproducts.test.ts
import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handleListProducts } from '@/lib/commands/listproducts';

describe('handleListProducts', () => {
  it('mostra un messaggio se non ci sono prodotti', async () => {
    const supabase = createFakeSupabase([{ data: [], error: null }]);
    const result = await handleListProducts({ supabase, chatId: 1, args: '' });
    expect(result.text).toContain('Nessun prodotto monitorato');
  });

  it('elenca i prodotti monitorati con id e stato', async () => {
    const supabase = createFakeSupabase([
      { data: [{ id: 1, title: 'Prodotto A', status: 'active' }, { id: 2, title: 'Prodotto B', status: 'paused' }], error: null },
    ]);
    const result = await handleListProducts({ supabase, chatId: 1, args: '' });
    expect(result.text).toBe('#1 [active] Prodotto A\n#2 [paused] Prodotto B');
  });
});
```

- [ ] **Step 8: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/commands/listproducts.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commands/listproducts'`

- [ ] **Step 9: Implementa `src/lib/commands/listproducts.ts`**

```ts
import type { CommandHandler } from './types';

export const handleListProducts: CommandHandler = async ({ supabase, chatId }) => {
  const { data, error } = await supabase
    .from('watched_listings')
    .select('id, title, status')
    .eq('chat_id', chatId)
    .order('id', { ascending: true });

  if (error) {
    return { text: `Errore nel recuperare i prodotti: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { text: 'Nessun prodotto monitorato. Usa /addproduct <link o ID eBay> per aggiungerne uno.' };
  }
  const lines = data.map((row: { id: number; title: string; status: string }) => `#${row.id} [${row.status}] ${row.title}`);
  return { text: lines.join('\n') };
};
```

- [ ] **Step 10: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/commands/listproducts.test.ts`
Expected: PASS (2 test passed)

- [ ] **Step 11: Scrivi i test per `/pause` e `/resume`**

```ts
// tests/lib/commands/pauseresume.test.ts
import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from '../../helpers/fakeSupabase';
import { handlePause, handleResume } from '@/lib/commands/pauseresume';

describe('handlePause / handleResume', () => {
  it('chiede un id valido se gli argomenti non sono un numero', async () => {
    const supabase = createFakeSupabase([]);
    const result = await handlePause({ supabase, chatId: 1, args: 'abc' });
    expect(result.text).toContain('Uso: /pause <id>');
  });

  it('segnala se il prodotto non esiste', async () => {
    const supabase = createFakeSupabase([{ data: null, error: null }]);
    const result = await handlePause({ supabase, chatId: 1, args: '99' });
    expect(result.text).toContain('Nessun prodotto trovato con id 99');
  });

  it('mette in pausa un prodotto esistente', async () => {
    const supabase = createFakeSupabase([{ data: { id: 1, title: 'Prodotto A' }, error: null }]);
    const result = await handlePause({ supabase, chatId: 1, args: '1' });
    expect(result.text).toBe('⏸️ In pausa: Prodotto A');
  });

  it('riprende un prodotto esistente', async () => {
    const supabase = createFakeSupabase([{ data: { id: 1, title: 'Prodotto A' }, error: null }]);
    const result = await handleResume({ supabase, chatId: 1, args: '1' });
    expect(result.text).toBe('▶️ Ripreso: Prodotto A');
  });
});
```

- [ ] **Step 12: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/commands/pauseresume.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commands/pauseresume'`

- [ ] **Step 13: Implementa `src/lib/commands/pauseresume.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandHandler, CommandResult } from './types';

async function setStatus(
  supabase: SupabaseClient,
  chatId: number,
  args: string,
  status: 'active' | 'paused'
): Promise<CommandResult> {
  const id = Number(args.trim());
  const commandName = status === 'paused' ? 'pause' : 'resume';
  if (!Number.isInteger(id)) {
    return { text: `Uso: /${commandName} <id>` };
  }
  const { data, error } = await supabase
    .from('watched_listings')
    .update({ status })
    .eq('id', id)
    .eq('chat_id', chatId)
    .select('id, title')
    .maybeSingle();

  if (error) {
    return { text: `Errore: ${error.message}` };
  }
  if (!data) {
    return { text: `Nessun prodotto trovato con id ${id}.` };
  }
  return { text: `${status === 'paused' ? '⏸️ In pausa' : '▶️ Ripreso'}: ${data.title}` };
}

export const handlePause: CommandHandler = (ctx) => setStatus(ctx.supabase, ctx.chatId, ctx.args, 'paused');
export const handleResume: CommandHandler = (ctx) => setStatus(ctx.supabase, ctx.chatId, ctx.args, 'active');
```

- [ ] **Step 14: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/commands/pauseresume.test.ts`
Expected: PASS (4 test passed)

- [ ] **Step 15: Scrivi i test per il router**

```ts
// tests/lib/commandRouter.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeSupabase } from '../helpers/fakeSupabase';
import { routeCommand, isAuthorized } from '@/lib/commandRouter';

describe('commandRouter', () => {
  const originalOwner = process.env.TELEGRAM_OWNER_CHAT_ID;

  beforeEach(() => {
    process.env.TELEGRAM_OWNER_CHAT_ID = '100';
  });

  afterEach(() => {
    process.env.TELEGRAM_OWNER_CHAT_ID = originalOwner;
  });

  it('isAuthorized riconosce solo il chat_id proprietario', () => {
    expect(isAuthorized(100)).toBe(true);
    expect(isAuthorized(200)).toBe(false);
  });

  it('rifiuta i comandi da chat non autorizzate', async () => {
    const supabase = createFakeSupabase([]);
    const result = await routeCommand(supabase, 200, '/listproducts');
    expect(result.text).toContain('Non sei autorizzato');
  });

  it('risponde con un messaggio di aiuto per comandi sconosciuti', async () => {
    const supabase = createFakeSupabase([]);
    const result = await routeCommand(supabase, 100, '/pippo');
    expect(result.text).toContain('Comando non riconosciuto');
  });

  it('dispatcha /listproducts al comando corretto', async () => {
    const supabase = createFakeSupabase([{ data: [], error: null }]);
    const result = await routeCommand(supabase, 100, '/listproducts');
    expect(result.text).toContain('Nessun prodotto monitorato');
  });

  it('risponde a /help con la lista dei comandi', async () => {
    const supabase = createFakeSupabase([]);
    const result = await routeCommand(supabase, 100, '/help');
    expect(result.text).toContain('/addproduct');
    expect(result.text).toContain('/listproducts');
  });
});
```

- [ ] **Step 16: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/lib/commandRouter.test.ts`
Expected: FAIL — `Cannot find module '@/lib/commandRouter'`

- [ ] **Step 17: Implementa `src/lib/commandRouter.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandResult } from './commands/types';
import { handleAddProduct } from './commands/addproduct';
import { handleListProducts } from './commands/listproducts';
import { handlePause, handleResume } from './commands/pauseresume';

const HELP_TEXT = `Comandi disponibili:
/addproduct <link o ID eBay> - inizia a monitorare un prodotto
/listproducts - elenco prodotti monitorati
/pause <id> - metti in pausa un prodotto
/resume <id> - riprendi il monitoraggio
/help - questo messaggio`;

const COMMANDS: Record<string, (ctx: CommandContext) => Promise<CommandResult>> = {
  '/start': async () => ({ text: 'Bot attivato. Usa /addproduct <link o ID eBay> per iniziare a monitorare un prodotto.' }),
  '/addproduct': handleAddProduct,
  '/listproducts': handleListProducts,
  '/pause': handlePause,
  '/resume': handleResume,
  '/help': async () => ({ text: HELP_TEXT }),
};

export function isAuthorized(chatId: number): boolean {
  return String(chatId) === process.env.TELEGRAM_OWNER_CHAT_ID;
}

export async function routeCommand(supabase: SupabaseClient, chatId: number, text: string): Promise<CommandResult> {
  if (!isAuthorized(chatId)) {
    return { text: 'Non sei autorizzato a usare questo bot.' };
  }
  const [command, ...rest] = text.trim().split(/\s+/);
  const args = rest.join(' ');
  const handler = COMMANDS[command.toLowerCase()];
  if (!handler) {
    return { text: `Comando non riconosciuto: ${command}. Usa /help per la lista dei comandi.` };
  }
  return handler({ supabase, chatId, args });
}
```

- [ ] **Step 18: Esegui il test e verifica che passi**

Run: `npm test -- tests/lib/commandRouter.test.ts`
Expected: PASS (5 test passed)

- [ ] **Step 19: Esegui l'intera suite di test**

Run: `npm test`
Expected: tutti i test passano (nessuna regressione sugli altri task)

- [ ] **Step 20: Commit**

```bash
git add src/lib/commands src/lib/commandRouter.ts tests/helpers/fakeSupabase.ts tests/lib/commands tests/lib/commandRouter.test.ts
git commit -m "feat: add Telegram commands (addproduct, listproducts, pause, resume) and router"
```

---

### Task 6: Route webhook Telegram

**Files:**
- Create: `src/app/api/telegram/webhook/route.ts`
- Test: `tests/app/api/telegram/webhook.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` da `@/lib/supabase` (Task 2); `routeCommand` da `@/lib/commandRouter` (Task 5); `sendMessage`, `verifyWebhookSecret`, `TelegramUpdate` da `@/lib/telegram` (Task 4)
- Produces: endpoint HTTP `POST /api/telegram/webhook`

- [ ] **Step 1: Scrivi i test per la route**

```ts
// tests/app/api/telegram/webhook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock('@/lib/commandRouter', () => ({ routeCommand: vi.fn() }));
vi.mock('@/lib/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/telegram')>();
  return { ...actual, sendMessage: vi.fn() };
});

import { routeCommand } from '@/lib/commandRouter';
import { sendMessage } from '@/lib/telegram';
import { POST } from '@/app/api/telegram/webhook/route';

function makeRequest(body: unknown, secret: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-telegram-bot-api-secret-token'] = secret;
  return new NextRequest('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/telegram/webhook', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'super-secret';
    vi.mocked(routeCommand).mockReset();
    vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined);
  });

  it('rifiuta richieste senza il secret corretto', async () => {
    const req = makeRequest({ message: { chat: { id: 1 }, text: '/help' } }, 'sbagliato');
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(routeCommand).not.toHaveBeenCalled();
  });

  it('ignora update senza testo', async () => {
    const req = makeRequest({ message: { chat: { id: 1 } } }, 'super-secret');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(routeCommand).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('dispatcha il comando e invia la risposta via Telegram', async () => {
    vi.mocked(routeCommand).mockResolvedValue({ text: 'risposta di test' });
    const req = makeRequest({ message: { chat: { id: 100 }, text: '/help' } }, 'super-secret');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(routeCommand).toHaveBeenCalledWith({}, 100, '/help');
    expect(sendMessage).toHaveBeenCalledWith(100, 'risposta di test');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- tests/app/api/telegram/webhook.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/telegram/webhook/route'`

- [ ] **Step 3: Implementa `src/app/api/telegram/webhook/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { routeCommand } from '@/lib/commandRouter';
import { sendMessage, verifyWebhookSecret, TelegramUpdate } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!verifyWebhookSecret(secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json()) as TelegramUpdate;
  const message = update.message;
  if (!message?.text || !message.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabaseClient();
  const result = await routeCommand(supabase, message.chat.id, message.text);
  await sendMessage(message.chat.id, result.text);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `npm test -- tests/app/api/telegram/webhook.test.ts`
Expected: PASS (3 test passed)

- [ ] **Step 5: Esegui l'intera suite e la build**

Run: `npm test && npm run build`
Expected: tutti i test passano, build Next.js completata senza errori

- [ ] **Step 6: Commit**

```bash
git add src/app/api/telegram/webhook/route.ts tests/app/api/telegram/webhook.test.ts
git commit -m "feat: add Telegram webhook route"
```

---

### Task 7: Script di registrazione webhook + README di setup

**Files:**
- Create: `scripts/set-webhook.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` da variabili d'ambiente
- Produces: comando `npm run set-webhook -- <url-pubblico>` per collegare il bot Telegram all'endpoint deployato

- [ ] **Step 1: Crea lo script di registrazione webhook**

```ts
// scripts/set-webhook.ts
async function main() {
  const url = process.argv[2];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!url) {
    console.error('Uso: npm run set-webhook -- <url-pubblico-completo>');
    process.exit(1);
  }
  if (!token || !secret) {
    console.error('TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET devono essere impostati nell\'ambiente.');
    process.exit(1);
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${url}/api/telegram/webhook`, secret_token: secret }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (!data.ok) {
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Aggiungi lo script a `package.json`**

Modifica la sezione `scripts` di `package.json` aggiungendo:

```json
    "set-webhook": "tsx scripts/set-webhook.ts"
```

E aggiungi `tsx` alle `devDependencies`:

```json
    "tsx": "^4.19.0"
```

- [ ] **Step 3: Installa la nuova dipendenza**

Run: `npm install`
Expected: `tsx` installato senza errori

- [ ] **Step 4: Scrivi il `README.md`**

```markdown
# eBay Listing Agent

Bot Telegram + backend Next.js/Supabase per monitorare inserzioni eBay selezionate dall'utente.
Vedi la spec completa in [`docs/superpowers/specs/2026-07-06-ebay-listing-agent-design.md`](docs/superpowers/specs/2026-07-06-ebay-listing-agent-design.md).

**Questo è il Piano 1**: fondamenta + gestione watchlist via Telegram (nessuna scrittura su eBay).
Il Piano 2 (analisi giornaliera, proposte, approvazione, applicazione modifiche) verrà sviluppato dopo l'approvazione dell'app eBay Developer.

## Setup locale

1. `npm install`
2. Copia `.env.example` in `.env.local` e compila:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — dal progetto Supabase
   - `TELEGRAM_BOT_TOKEN` — token ottenuto da @BotFather
   - `TELEGRAM_WEBHOOK_SECRET` — una stringa segreta a tua scelta, usata per verificare che le richieste arrivino davvero da Telegram
   - `TELEGRAM_OWNER_CHAT_ID` — il tuo chat_id Telegram (es. da @userinfobot)
   - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` — dalla app su developer.ebay.com (disponibili solo dopo l'approvazione)
3. Applica la migrazione `supabase/migrations/0001_watched_listings.sql` sul progetto Supabase.
4. `npm test` per verificare che tutto passi.

## Deploy

1. Deploy del progetto su Vercel con le stesse variabili d'ambiente configurate come Environment Variables del progetto.
2. Dopo il deploy, registra il webhook Telegram puntando all'URL pubblico:
   ```
   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- https://<il-tuo-dominio-vercel>
   ```
3. Scrivi `/start` al bot da Telegram per verificare che risponda.

## Comandi bot disponibili (Piano 1)

- `/addproduct <link o ID eBay>` — inizia a monitorare un'inserzione
- `/listproducts` — elenco prodotti monitorati
- `/pause <id>` / `/resume <id>` — sospendi/riprendi il monitoraggio
- `/help`
```

- [ ] **Step 5: Commit**

```bash
git add scripts/set-webhook.ts package.json package-lock.json README.md
git commit -m "docs: add setup README and webhook registration script"
```
