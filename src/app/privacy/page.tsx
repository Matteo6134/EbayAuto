export default function PrivacyPolicy() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
      <h1>Informativa sulla privacy</h1>
      <p>
        Questa applicazione (&quot;eBay Listing Agent&quot;) è uno strumento personale usato dal proprietario
        dell&apos;account eBay collegato per monitorare e gestire le proprie inserzioni tramite un bot Telegram privato.
      </p>
      <h2>Dati raccolti</h2>
      <p>
        L&apos;applicazione accede, tramite l&apos;autorizzazione OAuth concessa dal proprietario dell&apos;account eBay,
        ai dati delle inserzioni, degli ordini e delle statistiche di vendita dell&apos;account collegato. Raccoglie inoltre
        l&apos;identificativo della chat Telegram usata per inviare comandi e ricevere notifiche.
      </p>
      <h2>Utilizzo dei dati</h2>
      <p>
        I dati sono utilizzati esclusivamente per fornire al proprietario dell&apos;account funzionalità di monitoraggio,
        analisi e proposte di ottimizzazione delle proprie inserzioni eBay. Nessun dato viene condiviso con terze parti
        né utilizzato per finalità diverse da quelle qui descritte.
      </p>
      <h2>Conservazione ed eliminazione</h2>
      <p>
        I dati sono conservati solo per il tempo necessario a fornire il servizio. In caso di richiesta di cancellazione
        dell&apos;account eBay collegato (Marketplace Account Deletion), i dati associati vengono rimossi.
      </p>
      <h2>Contatti</h2>
      <p>Per qualsiasi domanda su questa informativa, contattare il proprietario dell&apos;applicazione.</p>
    </main>
  );
}
