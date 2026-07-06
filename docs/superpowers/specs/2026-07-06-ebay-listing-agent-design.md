# eBay Listing Optimization Agent — Design

**Data:** 2026-07-06
**Stato:** Approvato per la fase di planning

## Obiettivo

Un agente automatico che monitora una lista di inserzioni eBay scelte dall'utente, analizza ogni giorno le loro performance (visite, ordini, efficacia della pubblicità Promoted Listings), propone modifiche mirate (titolo, descrizione, item specifics, foto, prezzo, categoria, % ads) per aumentarne le vendite, e comunica tutto — recap giornaliero e proposte da approvare — via bot Telegram. Nessuna modifica viene applicata su eBay senza l'approvazione esplicita dell'utente tramite Telegram.

## Architettura

- **Hosting:** Vercel (serverless), riusando le competenze/infrastruttura già note dal progetto ACQDASH.
  - `/api/telegram/webhook` — endpoint sempre attivo che riceve messaggi e callback dai bottoni Telegram in tempo reale.
  - `/api/cron/daily-analysis` — invocato da Vercel Cron una volta al giorno; esegue l'analisi e genera le proposte.
- **Database:** Supabase (Postgres).
- **Motore di analisi:** step a regole (calcolo trend/soglie sui dati) + chiamata a Claude (Anthropic API) che, dati i numeri e i campi correnti dell'inserzione, genera proposte concrete con motivazione testuale.
- **Integrazione eBay:** OAuth2 (three-legged, consenso una tantum dell'utente), tramite:
  - Inventory API / Trading API — lettura e modifica campi inserzione (titolo, descrizione, item specifics, prezzo, categoria).
  - Marketing API — lettura/modifica % Promoted Listings.
  - Metriche di traffico/ordini — Trading API (`GetItem`, `GetMyeBaySelling`, hit count/watch count) e/o Analytics API se l'accesso lo consente (da verificare, vedi Rischi).
- **Integrazione Telegram:** Bot API, webhook su Vercel. Il bot risponde solo al chat_id autorizzato al primo `/start`.

## Modello dati (Supabase)

- `watched_listings` — id, ebay_item_id, titolo, categoria attuale, chat_id proprietario, stato (attivo/in pausa)
- `daily_metrics` — listing_id, data, visite/hit count, watcher, ordini, ricavo, % ads applicata
- `proposals` — id, listing_id, data, campo interessato, valore attuale, valore proposto, motivazione, livello di impatto (normale/alto), stato (in attesa/approvata/rifiutata/applicata), id messaggio Telegram collegato
- `change_log` — id, listing_id, campo, valore precedente, nuovo valore, data applicazione, esito misurato nei giorni successivi
- `telegram_users` — chat_id autorizzato

## Comandi Telegram

- `/start` — registra il chat_id come proprietario autorizzato (solo la prima volta)
- `/addproduct` — richiede link/ID inserzione eBay, lo valida via API, lo aggiunge al monitoraggio
- `/listproducts` — elenco prodotti monitorati con stato sintetico
- `/pause <id>` / `/resume <id>` — sospende/riprende il monitoraggio di un prodotto
- `/help`

## Flusso di approvazione

1. Ogni proposta arriva come messaggio con campo, valore attuale → proposto, motivazione, e bottoni **✅ Approva** / **❌ Rifiuta**.
2. Approvazione → applicazione immediata su eBay via API, log in `change_log`, conferma su Telegram (o messaggio di errore specifico se l'applicazione fallisce).
3. Rifiuto → proposta archiviata come rifiutata; l'agente non ripropone la stessa modifica a breve distanza.
4. Le proposte ad alto impatto (es. cambio categoria) sono segnalate in modo evidenziato prima dell'approvazione.

## Logica di analisi

Segnali valutati per ogni prodotto monitorato, ogni giorno:

- **Visibilità in calo** (visite/impressioni giù) → valuta aumento % Promoted Listings o revisione titolo/keyword.
- **Interesse senza conversione** (visite alte, pochi/nessun ordine) → valuta prezzo, foto, descrizione, item specifics.
- **Nessuna visibilità e nessun interesse** → segnale più forte: possibile titolo non ottimizzato, prezzo fuori mercato, o categoria sbagliata (proposta ad alto impatto, solo dopo aver escluso cause più semplici).
- **Efficacia della spesa ads** → se un aumento della % ads non produce risultati proporzionali, propone di abbassarla.

**Tracciamento esperimenti:** ogni modifica applicata viene confrontata "prima vs dopo" nei giorni successivi; il recap giornaliero riporta l'esito e puo proporre di tornare indietro se il cambiamento ha peggiorato la situazione.

## Recap giornaliero

Un messaggio Telegram per esecuzione del cron con: metriche del giorno per prodotto (confronto col giorno/settimana precedente), esito delle modifiche applicate di recente, e nuove proposte in attesa di approvazione con i relativi bottoni.

## Gestione errori

- Errore/scadenza token eBay su un prodotto → quel prodotto viene saltato per il ciclo corrente, notifica su Telegram, retry al giorno successivo; gli altri prodotti monitorati non sono impattati.
- Modifica approvata che fallisce lato eBay (es. validazione titolo) → notifica immediata con l'errore specifico, nessun fallimento silenzioso.
- Problemi infrastrutturali (Supabase/Vercel) → il recap di quel giorno puo saltare senza compromettere lo storico gia salvato.

## Rischi e incognite da verificare in fase di implementazione

- **Disponibilita dei dati di traffico via API:** l'Analytics API di eBay per impressioni/visite puo essere soggetta a restrizioni di accesso. Se non disponibile nella forma attesa, si useranno le metriche disponibili via Trading API (hit count, watch count) come proxy, con impatto comunicato chiaramente all'utente.
- **Cambio categoria:** puo richiedere la ricreazione dell'inserzione anziche una semplice modifica; va trattato come operazione delicata con conferma esplicita.
- **Approvazione app eBay Developer:** l'account e in attesa di approvazione; l'integrazione reale (incluso il collegamento OAuth one-time) potra partire solo dopo.

## Setup iniziale una tantum (fuori dallo sviluppo del codice)

1. Creazione bot Telegram tramite @BotFather e recupero token.
2. Collegamento OAuth one-time tra l'account eBay dell'utente e l'app.
3. Configurazione progetto Vercel e tabelle Supabase con le relative variabili d'ambiente/segreti.

## Fuori scope (per ora)

- Gestione automatica dell'intero catalogo eBay (si parte solo dai prodotti aggiunti esplicitamente via `/addproduct`).
- Applicazione di modifiche senza approvazione (l'utente ha scelto: approvazione sempre richiesta).
