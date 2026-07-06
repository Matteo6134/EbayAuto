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
