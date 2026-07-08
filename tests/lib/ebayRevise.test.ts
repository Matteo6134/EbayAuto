import { describe, it, expect, vi, afterEach } from 'vitest';
import { reviseListingField, applyProposal, escapeXml, reviseItemSpecifics } from '@/lib/ebayRevise';

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
