import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  reviseListingField,
  applyProposal,
  escapeXml,
  reviseItemSpecifics,
  reviseWithVariations,
  getExistingItemDetails,
} from '@/lib/ebayRevise';

const successXml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseItemResponse>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviseListingField', () => {
  it('chiama ReviseItem con il frammento XML del campo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => successXml,
    });
    vi.stubGlobal('fetch', fetchMock);

    await reviseListingField('access-token', '123456789012', '<StartPrice>17.99</StartPrice>');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ebay.com/ws/api.dll');
    expect(options.headers['X-EBAY-API-CALL-NAME']).toBe('ReviseItem');
    expect(options.body).toContain('<ItemID>123456789012</ItemID>');
    expect(options.body).toContain('<StartPrice>17.99</StartPrice>');
  });

  it('lancia un errore se la richiesta HTTP fallisce', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(reviseListingField('access-token', '123', '<StartPrice>10.00</StartPrice>')).rejects.toThrow(
      'ReviseItem fallita (status 500)'
    );
  });

  it('lancia un errore se eBay risponde con Ack Failure', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><LongMessage>Prezzo non valido</LongMessage></Errors>
</ReviseItemResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));
    await expect(reviseListingField('access-token', '123', '<StartPrice>10.00</StartPrice>')).rejects.toThrow(
      'ReviseItem ha restituito un errore: Prezzo non valido'
    );
  });
});

describe('applyProposal', () => {
  it('applica una modifica di prezzo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => successXml,
    });
    vi.stubGlobal('fetch', fetchMock);

    await applyProposal('access-token', '123456789012', 'price', '17.99');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain('<StartPrice>17.99</StartPrice>');
  });

  it('applica una modifica di titolo con ReviseItem', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => successXml,
    });
    vi.stubGlobal('fetch', fetchMock);

    await applyProposal('access-token', '123456789012', 'title', 'Nuovo titolo & migliore');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain('<ItemID>123456789012</ItemID>');
    expect(options.body).toContain('<Title>Nuovo titolo &amp; migliore</Title>');
  });

  it('tronca il titolo a 80 caratteri', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => successXml,
    });
    vi.stubGlobal('fetch', fetchMock);

    const longTitle = 'x'.repeat(100);
    await applyProposal('access-token', '123', 'title', longTitle);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toContain(`<Title>${'x'.repeat(80)}</Title>`);
    expect(options.body).not.toContain('x'.repeat(81));
  });

  it('lancia un errore per campi non supportati', async () => {
    // Nessuno stub fetch necessario: il campo non supportato deve fallire
    // PRIMA di qualsiasi chiamata di rete (la guardia globale la bloccherebbe).
    await expect(applyProposal('access-token', '123', 'foobar', 'valore')).rejects.toThrow(
      'Applicazione automatica non supportata per il campo "foobar"'
    );
  });
});

describe('escapeXml', () => {
  it('esegue l\'escape di tutti i caratteri XML speciali', () => {
    expect(escapeXml('Tom & Jerry <"quoted\'>')).toBe('Tom &amp; Jerry &lt;&quot;quoted&apos;&gt;');
  });
});

describe('reviseItemSpecifics', () => {
  const getItemWithSpecifics = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>ITEM1</ItemID>
    <Title>Trapano</Title>
    <ConditionID>1000</ConditionID>
    <ItemSpecifics>
      <NameValueList><Name>Marca</Name><Value>Bosch</Value></NameValueList>
      <NameValueList><Name>Colore</Name><Value>Verde</Value></NameValueList>
    </ItemSpecifics>
  </Item>
</GetItemResponse>`;

  it('unisce le specifiche esistenti (da GetItem) con quelle nuove, sovrascrivendo per nome (case-insensitive)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => getItemWithSpecifics }) // GetItem
      .mockResolvedValueOnce({ ok: true, text: async () => successXml }); // ReviseItem
    vi.stubGlobal('fetch', fetchMock);

    await reviseItemSpecifics('access-token', 'ITEM1', { marca: 'Makita', Potenza: '750W' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, reviseOptions] = fetchMock.mock.calls[1];
    const body = reviseOptions.body as string;

    // il nuovo valore sovrascrive "Marca" esistente (match case-insensitive)
    expect(body).toContain('<Name>marca</Name><Value>Makita</Value>');
    expect(body).not.toContain('Bosch');
    // "Colore" esistente viene preservato
    expect(body).toContain('<Name>Colore</Name><Value>Verde</Value>');
    // nuova specifica aggiunta
    expect(body).toContain('<Name>Potenza</Name><Value>750W</Value>');
  });

  it('esegue l\'escape di nomi e valori forniti dall\'utente', async () => {
    const getItemNoSpecifics = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>ITEM1</ItemID>
    <Title>Trapano</Title>
  </Item>
</GetItemResponse>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => getItemNoSpecifics })
      .mockResolvedValueOnce({ ok: true, text: async () => successXml });
    vi.stubGlobal('fetch', fetchMock);

    await reviseItemSpecifics('access-token', 'ITEM1', { 'Marca & Modello': 'Bosch <Pro>' });

    const [, reviseOptions] = fetchMock.mock.calls[1];
    expect(reviseOptions.body).toContain('<Name>Marca &amp; Modello</Name><Value>Bosch &lt;Pro&gt;</Value>');
  });

  it('propaga l\'errore se ReviseItem restituisce un Ack di errore', async () => {
    const getItemMinimal = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item><ItemID>ITEM1</ItemID></Item>
</GetItemResponse>`;
    const failureXml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><ShortMessage>Specifiche non valide</ShortMessage></Errors>
</ReviseItemResponse>`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => getItemMinimal })
      .mockResolvedValueOnce({ ok: true, text: async () => failureXml });
    vi.stubGlobal('fetch', fetchMock);

    await expect(reviseItemSpecifics('access-token', 'ITEM1', { Marca: 'Bosch' })).rejects.toThrow(
      'Specifiche non valide'
    );
  });
});

describe('getExistingItemDetails - quantity e quantitySold', () => {
  it('legge quantity e quantitySold da GetItem', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>ITEM1</ItemID>
    <Title>Lampada da tavolo</Title>
    <Quantity>5</Quantity>
    <SellingStatus><QuantitySold>2</QuantitySold></SellingStatus>
  </Item>
</GetItemResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const details = await getExistingItemDetails('access-token', 'ITEM1');

    expect(details?.quantity).toBe(5);
    expect(details?.quantitySold).toBe(2);
  });

  it('usa i valori di default quando Quantity/QuantitySold sono assenti', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>ITEM1</ItemID>
    <Title>Lampada da tavolo</Title>
  </Item>
</GetItemResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const details = await getExistingItemDetails('access-token', 'ITEM1');

    expect(details?.quantity).toBe(1);
    expect(details?.quantitySold).toBe(0);
  });
});

describe('reviseWithVariations', () => {
  const successVariationsXml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>Success</Ack></ReviseFixedPriceItemResponse>`;

  it('chiama ReviseFixedPriceItem con il blocco Variations corretto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => successVariationsXml });
    vi.stubGlobal('fetch', fetchMock);

    await reviseWithVariations(
      'access-token',
      'ITEM1',
      'Lampadina',
      [
        { value: 'Con lampadina', price: 88.83 },
        { value: 'Senza lampadina', price: 60 },
      ],
      3
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ebay.com/ws/api.dll');
    expect(options.headers['X-EBAY-API-CALL-NAME']).toBe('ReviseFixedPriceItem');

    const body = options.body as string;
    expect(body).toContain('<ItemID>ITEM1</ItemID>');
    expect(body).toContain('<VariationSpecificsSet>');
    expect(body).toContain('<Name>Lampadina</Name>');
    expect(body).toContain('<Value>Con lampadina</Value>');
    expect(body).toContain('<Value>Senza lampadina</Value>');

    expect(body).toContain('<SKU>ITEM1-VAR1</SKU>');
    expect(body).toContain('<SKU>ITEM1-VAR2</SKU>');
    expect(body).toContain('<StartPrice>88.83</StartPrice>');
    expect(body).toContain('<StartPrice>60.00</StartPrice>');
    // ogni variazione ha la propria quantità
    expect(body.match(/<Quantity>3<\/Quantity>/g)?.length).toBe(2);
    // ogni variazione dichiara EAN "Non applicabile" (richiesto da eBay quando
    // l'inserzione originale ha un codice prodotto a livello di item)
    expect(body.match(/<EAN>Non applicabile<\/EAN>/g)?.length).toBe(2);
  });

  it('esegue l\'escape dei valori forniti dall\'utente', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => successVariationsXml });
    vi.stubGlobal('fetch', fetchMock);

    await reviseWithVariations(
      'access-token',
      'ITEM1',
      'Colore & Taglia',
      [
        { value: 'Rosso <XL>', price: 10 },
        { value: 'Blu & Nero', price: 20 },
      ],
      1
    );

    const [, options] = fetchMock.mock.calls[0];
    const body = options.body as string;
    expect(body).toContain('<Name>Colore &amp; Taglia</Name>');
    expect(body).toContain('<Value>Rosso &lt;XL&gt;</Value>');
    expect(body).toContain('<Value>Blu &amp; Nero</Value>');
  });

  it('lancia un errore se la richiesta HTTP fallisce', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(
      reviseWithVariations('access-token', 'ITEM1', 'Lampadina', [
        { value: 'A', price: 10 },
        { value: 'B', price: 20 },
      ], 1)
    ).rejects.toThrow('ReviseFixedPriceItem fallita (status 500)');
  });

  it('lancia un errore se eBay risponde con Ack Failure e un solo messaggio', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><LongMessage>Impossibile creare le varianti</LongMessage></Errors>
</ReviseFixedPriceItemResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    await expect(
      reviseWithVariations('access-token', 'ITEM1', 'Lampadina', [
        { value: 'A', price: 10 },
        { value: 'B', price: 20 },
      ], 1)
    ).rejects.toThrow('ReviseFixedPriceItem ha restituito un errore: Impossibile creare le varianti');
  });

  it('lancia un errore concatenando più messaggi quando Errors è un array', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><LongMessage>Prezzo non valido</LongMessage></Errors>
  <Errors><LongMessage>SKU duplicato</LongMessage></Errors>
</ReviseFixedPriceItemResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    await expect(
      reviseWithVariations('access-token', 'ITEM1', 'Lampadina', [
        { value: 'A', price: 10 },
        { value: 'B', price: 20 },
      ], 1)
    ).rejects.toThrow('ReviseFixedPriceItem ha restituito un errore: Prezzo non valido | SKU duplicato');
  });
});
