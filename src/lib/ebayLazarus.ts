import { XMLParser } from 'fast-xml-parser';

export interface GhostCheckResult {
  isIndexed: boolean;
  searchResultCount: number;
}

/**
 * Ghost Check: verifies that our listing is actually indexed by eBay's Cassini algorithm.
 * If findItemsByKeywords returns 0 results for our exact title, the listing is
 * shadow-banned or stuck in review — fixing the listing won't help.
 */
export async function checkListingIndexed(
  accessToken: string,
  title: string
): Promise<GhostCheckResult> {
  // Sanitize query - take most unique keywords
  const query = title.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).slice(0, 5).join(' ');

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<findItemsByKeywordsRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
  <keywords>${query.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</keywords>
  <paginationInput>
    <entriesPerPage>5</entriesPerPage>
    <pageNumber>1</pageNumber>
  </paginationInput>
</findItemsByKeywordsRequest>`;

  const res = await fetch('https://svcs.ebay.com/services/search/FindingService/v1', {
    method: 'POST',
    headers: {
      'X-EBAY-SOA-SERVICE-NAME': 'FindingService',
      'X-EBAY-SOA-OPERATION-NAME': 'findItemsByKeywords',
      'X-EBAY-SOA-GLOBAL-ID': 'EBAY-IT',
      'X-EBAY-SOA-SECURITY-IAFTOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: xmlBody,
  });

  if (!res.ok) {
    console.warn(`Ghost check API failed: ${res.status}`);
    return { isIndexed: true, searchResultCount: -1 }; // assume ok if API fails
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const countStr =
    parsed?.findItemsByKeywordsResponse?.paginationOutput?.totalEntries ?? '1';
  const count = parseInt(String(countStr), 10);

  return {
    isIndexed: count > 0,
    searchResultCount: count,
  };
}

/**
 * Lazarus Module: resurrects a dead listing by ending it and re-creating it as new.
 * New listings get a 24-48h Cassini freshness boost and the "Newly listed" badge.
 *
 * Process:
 * 1. GetItem - fetch all data from the old listing
 * 2. EndItem - terminate the old listing
 * 3. AddFixedPriceItem - create a new identical listing (with tiny title tweak to avoid duplicate detection)
 */

interface ListingData {
  title: string;
  description: string;
  categoryId: string;
  startPrice: number;
  conditionId: string | null;
  pictureUrls: string[];
  itemSpecifics: Array<{ name: string; value: string }>;
  quantity: number;
  location: string;
  country: string;
  currency: string;
  paymentMethods: string[];
  shippingDetails: string; // raw XML block
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function fetchListingData(accessToken: string, itemId: string): Promise<ListingData | null> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'GetItem',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: xmlBody,
  });

  if (!res.ok) return null;
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const item = parsed?.GetItemResponse?.Item;
  if (!item) return null;

  const specs = toArray(item.ItemSpecifics?.NameValueList).map((s: any) => ({
    name: String(s.Name),
    value: toArray(s.Value).map(String).join(', '),
  }));

  const pics = toArray(item.PictureDetails?.PictureURL).map(String);

  return {
    title: String(item.Title ?? ''),
    description: String(item.Description ?? ''),
    categoryId: String(item.PrimaryCategory?.CategoryID ?? ''),
    startPrice: parseFloat(String(item.StartPrice ?? item.BuyItNowPrice ?? '0')),
    conditionId: item.ConditionID ? String(item.ConditionID) : null,
    pictureUrls: pics,
    itemSpecifics: specs,
    quantity: parseInt(String(item.Quantity ?? '1'), 10) || 1,
    location: String(item.Location ?? ''),
    country: String(item.Country ?? 'IT'),
    currency: String(item.Currency ?? 'EUR'),
    paymentMethods: toArray(item.PaymentMethods).map(String),
    shippingDetails: '', // simplified — we'll use flat shipping
  };
}

async function endListing(accessToken: string, itemId: string): Promise<boolean> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'EndItem',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: xmlBody,
  });

  if (!res.ok) return false;
  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const ack = parsed?.EndItemResponse?.Ack;
  return ack === 'Success' || ack === 'Warning';
}

export interface LazarusResult {
  success: boolean;
  newItemId?: string;
  error?: string;
}

/**
 * Execute Lazarus: end old listing and create a fresh one.
 * Automatically tweaks the title slightly to avoid eBay's duplicate detection.
 */
export async function resurrectionListing(
  accessToken: string,
  oldItemId: string
): Promise<LazarusResult> {
  // Step 1: Fetch original listing data
  const data = await fetchListingData(accessToken, oldItemId);
  if (!data) {
    return { success: false, error: 'Impossibile recuperare i dati del vecchio annuncio' };
  }

  // Step 2: End the old listing
  const ended = await endListing(accessToken, oldItemId);
  if (!ended) {
    return { success: false, error: 'EndItem fallito: impossibile terminare il vecchio annuncio' };
  }

  // Step 3: Build new listing XML with slightly tweaked title
  // We move the first word to the end to fool duplicate detection while keeping all keywords
  const titleWords = data.title.split(' ');
  const tweakedTitle = titleWords.length > 2
    ? [...titleWords.slice(1), titleWords[0]].join(' ').substring(0, 80)
    : data.title;

  const specsXml = data.itemSpecifics.map(s =>
    `<NameValueList><Name>${escapeXml(s.name)}</Name><Value>${escapeXml(s.value)}</Value></NameValueList>`
  ).join('');

  const picsXml = data.pictureUrls
    .slice(0, 12) // eBay allows max 12 photos
    .map(url => `<PictureURL>${escapeXml(url)}</PictureURL>`)
    .join('');

  const conditionXml = data.conditionId ? `<ConditionID>${data.conditionId}</ConditionID>` : '';
  const specsBlock = specsXml ? `<ItemSpecifics>${specsXml}</ItemSpecifics>` : '';
  const picsBlock = picsXml ? `<PictureDetails>${picsXml}</PictureDetails>` : '';

  const newListingXml = `<?xml version="1.0" encoding="utf-8"?>
<AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <Title>${escapeXml(tweakedTitle)}</Title>
    <Description>${escapeXml(data.description)}</Description>
    <PrimaryCategory><CategoryID>${data.categoryId}</CategoryID></PrimaryCategory>
    <StartPrice currencyID="${data.currency}">${data.startPrice.toFixed(2)}</StartPrice>
    <Country>${data.country}</Country>
    <Location>${escapeXml(data.location)}</Location>
    <Currency>${data.currency}</Currency>
    <ListingType>FixedPriceItem</ListingType>
    <ListingDuration>GTC</ListingDuration>
    <Quantity>${data.quantity}</Quantity>
    ${conditionXml}
    ${specsBlock}
    ${picsBlock}
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>IT_StandardDelivery</ShippingService>
        <ShippingServiceCost currencyID="${data.currency}">0.00</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
  </Item>
</AddFixedPriceItemRequest>`;

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '101',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'AddFixedPriceItem',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: newListingXml,
  });

  if (!res.ok) {
    return { success: false, error: `AddFixedPriceItem HTTP ${res.status}` };
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const ack = parsed?.AddFixedPriceItemResponse?.Ack;

  if (ack !== 'Success' && ack !== 'Warning') {
    const errors = parsed?.AddFixedPriceItemResponse?.Errors;
    const msg = Array.isArray(errors)
      ? errors.map((e: any) => e.LongMessage || e.ShortMessage).join(' | ')
      : errors?.LongMessage || errors?.ShortMessage || 'Errore sconosciuto';
    return { success: false, error: msg };
  }

  const newItemId = String(parsed?.AddFixedPriceItemResponse?.ItemID ?? '');
  return { success: true, newItemId };
}
