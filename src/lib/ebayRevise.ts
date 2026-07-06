import { XMLParser } from 'fast-xml-parser';

export async function reviseListingPrice(accessToken: string, itemId: string, newPrice: number): Promise<void> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${newPrice.toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'ReviseItem',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: xmlBody,
  });

  if (!res.ok) {
    throw new Error(`ReviseItem fallita (status ${res.status})`);
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const ack = parsed?.ReviseItemResponse?.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const message = parsed?.ReviseItemResponse?.Errors?.LongMessage ?? 'risposta eBay non valida';
    throw new Error(`ReviseItem ha restituito un errore: ${message}`);
  }
}

export async function applyProposal(
  accessToken: string,
  itemId: string,
  field: string,
  proposedValue: string
): Promise<void> {
  switch (field) {
    case 'price':
      await reviseListingPrice(accessToken, itemId, Number(proposedValue));
      return;
    default:
      throw new Error(`Applicazione automatica non supportata per il campo "${field}"`);
  }
}
