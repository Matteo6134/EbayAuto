import { XMLParser } from 'fast-xml-parser';

export interface EbayActiveListing {
  itemId: string;
  title: string;
  categoryId: string;
}

const REQUEST_BODY = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Sort>TimeLeft</Sort>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function getActiveListings(accessToken: string): Promise<EbayActiveListing[]> {
  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: REQUEST_BODY,
  });

  if (!res.ok) {
    throw new Error(`GetMyeBaySelling fallita (status ${res.status})`);
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const ack = parsed?.GetMyeBaySellingResponse?.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const message = parsed?.GetMyeBaySellingResponse?.Errors?.LongMessage ?? 'risposta eBay non valida';
    throw new Error(`GetMyeBaySelling ha restituito un errore: ${message}`);
  }

  const items = toArray(parsed?.GetMyeBaySellingResponse?.ActiveList?.ItemArray?.Item);

  return items.map((item: any) => ({
    itemId: String(item.ItemID),
    title: String(item.Title),
    categoryId: String(item.PrimaryCategory?.CategoryID ?? ''),
  }));
}
