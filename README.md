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
