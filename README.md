# eBay Listing Agent

Bot Telegram + backend Next.js/Supabase per monitorare inserzioni eBay selezionate dall'utente.
Vedi la spec completa in [`docs/superpowers/specs/2026-07-06-ebay-listing-agent-design.md`](docs/superpowers/specs/2026-07-06-ebay-listing-agent-design.md).

**Piano 1**: fondamenta + gestione watchlist via Telegram, validazione inserzioni via Browse API (nessuna scrittura su eBay).
**Estensione OAuth**: collegamento vero e proprio all'account eBay (three-legged OAuth) per scansionare automaticamente le inserzioni attive del venditore.
Il Piano 2 completo (analisi giornaliera, proposte di ottimizzazione, approvazione via Telegram, applicazione modifiche, % Promoted Listings) resta da progettare/costruire.

## Setup locale

1. `npm install`
2. Copia `.env.example` in `.env.local` e compila:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — dal progetto Supabase
   - `TELEGRAM_BOT_TOKEN` — token ottenuto da @BotFather
   - `TELEGRAM_WEBHOOK_SECRET` — una stringa segreta a tua scelta, usata per verificare che le richieste arrivino davvero da Telegram
   - `TELEGRAM_OWNER_CHAT_ID` — il tuo chat_id Telegram (es. da @userinfobot)
   - `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` — dalla app su developer.ebay.com (chiavi di produzione)
   - `EBAY_VERIFICATION_TOKEN` — stringa a scelta (32-80 caratteri alfanumerici/`_`/`-`), usata per la verifica dell'endpoint Marketplace Account Deletion
   - `EBAY_MARKETPLACE_DELETION_ENDPOINT` — URL pubblico esatto di `/api/ebay/marketplace-account-deletion` (deve combaciare con quanto registrato su eBay)
   - `EBAY_RUNAME` — il RuName generato su developer.ebay.com (sezione "User Tokens" → "Get a Token from eBay via Your Application"), configurando come Auth accepted URL `.../api/ebay/oauth/callback` e come Privacy Policy URL `.../privacy`
3. Applica le migrazioni in `supabase/migrations/` (in ordine) sul progetto Supabase.
4. `npm test` per verificare che tutto passi.

## Deploy

1. Deploy del progetto su Vercel con le stesse variabili d'ambiente configurate come Environment Variables del progetto.
2. Dopo il deploy, registra il webhook Telegram puntando all'URL pubblico:
   ```
   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook -- https://<il-tuo-dominio-vercel>
   ```
3. Scrivi `/start` al bot da Telegram per verificare che risponda.

## Comandi bot disponibili

- `/addproduct <link o ID eBay>` — inizia a monitorare un'inserzione
- `/listproducts` — elenco prodotti monitorati
- `/pause <id>` / `/resume <id>` — sospendi/riprendi il monitoraggio
- `/connectebay` — collega il proprio account eBay via OAuth
- `/scanproducts` — legge le inserzioni attive dell'account eBay collegato e aggiunge quelle non ancora monitorate
- `/help`
