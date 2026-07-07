import { describe, it, expect, vi, afterEach } from 'vitest';
import { reviseListingField, applyProposal } from '@/lib/ebayRevise';

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
