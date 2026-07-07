import { XMLParser } from 'fast-xml-parser';

export async function reviseListingField(accessToken: string, itemId: string, fieldXml: string): Promise<void> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${itemId}</ItemID>
    ${fieldXml}
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
      await reviseListingField(accessToken, itemId, `<StartPrice>${Number(proposedValue).toFixed(2)}</StartPrice>`);
      return;
    case 'title':
      // limit title to 80 chars
      const newTitle = proposedValue.substring(0, 80).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await reviseListingField(accessToken, itemId, `<Title>${newTitle}</Title>`);
      return;
    case 'category':
      await reviseListingField(accessToken, itemId, `<PrimaryCategory><CategoryID>${proposedValue}</CategoryID></PrimaryCategory>`);
      return;
    default:
      throw new Error(`Applicazione automatica non supportata per il campo "${field}"`);
  }
}
