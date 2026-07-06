# eBay Listing Agent — Piano 2: Motore di Analisi e Ottimizzazione — Design

**Data:** 2026-07-06
**Stato:** Approvato per la fase di planning

## Contesto

Il Piano 1 (fondamenta + bot Telegram + watchlist) e il collegamento OAuth eBay (three-legged, con `/connectebay` e `/scanproducts`) sono già stati implementati e sono in produzione. Questo documento copre il Piano 2: il motore che analizza ogni giorno le inserzioni monitorate, propone modifiche per aumentarne le vendite, e le applica su approvazione dell'utente via Telegram.

## Obiettivo

Per ogni prodotto in `watched_listings` con un account eBay collegato (`ebay_connection`), il sistema:
1. Raccoglie ogni giorno le metriche (visite, watcher, ordini, % Promoted Listings attuale)
2. Le confronta con lo storico per individuare segnali (calo di visibilità, interesse senza conversione, ecc.)
3. Genera proposte di modifica concrete (titolo, descrizione, prezzo, categoria, % ads) con motivazione
4. Manda le proposte su Telegram con bottoni di approvazione; applica la modifica solo su approvazione esplicita
5. Traccia l'esito delle modifiche applicate nei giorni successivi
6. Fornisce un recap su richiesta (`/recap <id>`) e un recap automatico giornaliero di tutti i prodotti

## Architettura

- **Cron giornaliero:** route Vercel Cron `/api/cron/daily-analysis`, schedulata alle **19:00 UTC (20:00 ora italiana)**, protetta da un header/secret di autorizzazione (non richiamabile da terzi). Nota: durante l'ora legale (CEST, UTC+2) l'orario locale effettivo slitta di un'ora (21:00); accettabile per uno strumento personale, non gestiamo il cambio automatico.
- **Motore di analisi:** logica a regole fisse (nessuna chiamata a modelli esterni), deterministica e testabile.
- **Integrazione eBay:**
  - Metriche (visite/watcher/vendite): Trading API `GetMyeBaySelling` (stessa chiamata già usata da `/scanproducts`), sezioni `ActiveList` (hit count, watch count) e `SoldList` (vendite recenti).
  - % Promoted Listings: Marketing API (`GET/POST /sell/marketing/v1/ad_campaign` e risorse `ad`) — lettura e scrittura della % di offerta per le campagne Promoted Listings Standard.
  - Modifiche a titolo/descrizione/prezzo/categoria: Trading API `ReviseItem`.
- **Telegram:** aggiunta del supporto a bottoni inline (`reply_markup` su `sendMessage`, e `answerCallbackQuery` per confermare il tap) per il flusso di approvazione.

## Modello dati (nuove tabelle Supabase)

- `daily_metrics` — id, listing_id (FK verso `watched_listings`), data, hit_count, watch_count, quantity_sold, revenue, ad_rate_percent, creato il giorno della raccolta (una riga per prodotto per giorno)
- `proposals` — id, listing_id, data, campo interessato (title/description/price/category/ad_rate), valore attuale, valore proposto, motivazione, livello di impatto (normale/alto), stato (in attesa/approvata/rifiutata/applicata/fallita), id messaggio Telegram associato
- `change_log` — id, listing_id, campo, valore precedente, nuovo valore, data applicazione, esito misurato (riferimento a `daily_metrics` prima/dopo, valutato nei giorni successivi)

## Raccolta metriche

Ogni prodotto monitorato con collegamento eBay attivo viene interrogato una volta al giorno:
- **Hit count / watch count** dalla stessa chiamata `GetMyeBaySelling` (ActiveList) già usata per la scansione — nessuna chiamata aggiuntiva.
- **Vendite del giorno**: dalla sezione `SoldList` della stessa chiamata, filtrando per data.
- **% ads attuale**: interrogazione Marketing API per verificare se l'inserzione fa già parte di una campagna Promoted Listings e con quale percentuale. Se non risulta in nessuna campagna, la % ads è considerata "non impostata" (0%).

**Rischio noto**: la Marketing API per Promoted Listings richiede la gestione di "campagne" (non è un singolo valore per inserzione) — è la parte tecnicamente più delicata del piano. Verrà implementata come ultimo blocco di lavoro, dopo che raccolta metriche, motore di analisi, proposte su titolo/prezzo/categoria, approvazione e recap sono già funzionanti e testabili.

## Motore di analisi (regole)

Per ogni prodotto, confrontando i dati di oggi con lo storico recente (ultimi 3-7 giorni in `daily_metrics`):

- **Visibilità in calo** (hit/watch count in calo rispetto alla media recente) → proposta: aumentare % ads, oppure rivedere titolo se non in campagna pubblicitaria attiva.
- **Interesse senza conversione** (hit/watch count alti, nessuna vendita recente) → proposta: rivedere prezzo o descrizione.
- **Nessuna visibilità e nessun interesse** (entrambi bassi da diversi giorni) → proposta ad alto impatto: possibile cambio categoria, dopo aver escluso le cause più semplici.
- **% ads inefficace** (aumentata di recente senza aumento proporzionale di visite/vendite) → proposta: riportarla a un valore inferiore.

Ogni proposta include: campo, valore attuale, valore proposto, motivazione testuale basata sui numeri osservati.

## Flusso di approvazione

1. Il cron genera le proposte del giorno e le salva in `proposals` con stato "in attesa".
2. Per ognuna, invia un messaggio Telegram con bottoni **✅ Approva** / **❌ Rifiuta** (`reply_markup` inline keyboard, `callback_data` con l'id della proposta).
3. Al tap, il webhook riceve un `callback_query`: risponde subito con `answerCallbackQuery` (evita lo spinner infinito su Telegram), poi:
   - **Approva** → applica la modifica su eBay (Trading API `ReviseItem` o Marketing API secondo il campo), aggiorna `proposals` a "applicata" (o "fallita" con messaggio di errore specifico se l'API eBay rifiuta la modifica), scrive su `change_log`.
   - **Rifiuta** → stato "rifiutata"; la stessa proposta non viene rigenerata a breve distanza per lo stesso prodotto/campo.
4. Le proposte ad alto impatto (cambio categoria) sono segnalate in modo evidenziato nel messaggio.

## Recap

- **`/recap <id>`**: su richiesta, mostra le metriche recenti del singolo prodotto (confronto con i giorni precedenti), le modifiche applicate di recente e il loro esito, e le eventuali proposte in attesa.
- **Recap automatico giornaliero** (dentro lo stesso cron delle 19:00 UTC): un messaggio riassuntivo per tutti i prodotti attivi, con le nuove proposte del giorno allegate.

## Gestione errori

- Se la raccolta metriche fallisce per un prodotto (token scaduto, errore eBay), quel prodotto viene saltato per il ciclo corrente; gli altri non sono impattati; l'errore viene loggato lato server.
- Se il refresh del token eBay fallisce (refresh token scaduto/revocato), il recap segnala che serve ripetere `/connectebay`.
- Se una modifica approvata fallisce lato eBay, lo stato della proposta diventa "fallita" con il messaggio d'errore specifico, comunicato subito su Telegram — nessun fallimento silenzioso.

## Fuori scope

- Nessuna modifica applicata senza approvazione esplicita (confermato: sempre richiesta).
- Nessun ragionamento tramite modelli esterni (Claude o altri) in questa fase — motore a regole fisse, deterministico e testabile.
- Multi-account/multi-utente: resta scoperto un solo chat_id proprietario, come nel Piano 1.
