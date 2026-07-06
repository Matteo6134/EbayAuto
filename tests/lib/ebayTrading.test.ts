import { describe, it, expect, vi, afterEach } from 'vitest';
import { getActiveListings, getSellingSnapshot } from '@/lib/ebayTrading';

function xmlResponse(body: string) {
  return { ok: true, text: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getActiveListings', () => {
  it('estrae piu inserzioni attive dalla risposta XML', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>
      <Item>
        <ItemID>123456789012</ItemID>
        <Title>Prodotto Uno</Title>
        <PrimaryCategory><CategoryID>111</CategoryID></PrimaryCategory>
      </Item>
      <Item>
        <ItemID>223456789012</ItemID>
        <Title>Prodotto Due</Title>
        <PrimaryCategory><CategoryID>222</CategoryID></PrimaryCategory>
      </Item>
    </ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xmlResponse(xml)));

    const listings = await getActiveListings('access-token');

    expect(listings).toEqual([
      { itemId: '123456789012', title: 'Prodotto Uno', categoryId: '111' },
      { itemId: '223456789012', title: 'Prodotto Due', categoryId: '222' },
    ]);
  });

  it('gestisce correttamente una singola inserzione (non un array)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>
      <Item>
        <ItemID>123456789012</ItemID>
        <Title>Prodotto Unico</Title>
        <PrimaryCategory><CategoryID>111</CategoryID></PrimaryCategory>
      </Item>
    </ItemArray>
  </ActiveList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xmlResponse(xml)));

    const listings = await getActiveListings('access-token');

    expect(listings).toEqual([{ itemId: '123456789012', title: 'Prodotto Unico', categoryId: '111' }]);
  });

  it('ritorna un array vuoto se non ci sono inserzioni attive', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList></ActiveList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xmlResponse(xml)));

    const listings = await getActiveListings('access-token');

    expect(listings).toEqual([]);
  });

  it('lancia un errore se la richiesta HTTP fallisce', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getActiveListings('access-token')).rejects.toThrow('GetMyeBaySelling fallita (status 500)');
  });

  it('lancia un errore se eBay risponde con Ack Failure', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors><LongMessage>Token scaduto</LongMessage></Errors>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xmlResponse(xml)));

    await expect(getActiveListings('access-token')).rejects.toThrow(
      'GetMyeBaySelling ha restituito un errore: Token scaduto'
    );
  });
});

describe('getSellingSnapshot', () => {
  it('estrae watcher, prezzo e vendite dalla risposta XML', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList>
    <ItemArray>
      <Item>
        <ItemID>123456789012</ItemID>
        <Title>Prodotto Uno</Title>
        <PrimaryCategory><CategoryID>111</CategoryID></PrimaryCategory>
        <WatchCount>7</WatchCount>
        <StartPrice>19.99</StartPrice>
      </Item>
    </ItemArray>
  </ActiveList>
  <SoldList>
    <OrderTransactionArray>
      <OrderTransaction>
        <Transaction>
          <Item><ItemID>123456789012</ItemID></Item>
          <QuantityPurchased>2</QuantityPurchased>
          <TransactionPrice>19.99</TransactionPrice>
        </Transaction>
      </OrderTransaction>
    </OrderTransactionArray>
  </SoldList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const snapshot = await getSellingSnapshot('access-token');

    expect(snapshot.listings).toEqual([
      { itemId: '123456789012', title: 'Prodotto Uno', categoryId: '111', watchCount: 7, price: 19.99 },
    ]);
    expect(snapshot.soldItems).toEqual([{ itemId: '123456789012', quantitySold: 2, revenue: 39.98 }]);
  });

  it('somma più transazioni per lo stesso itemId', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList><ItemArray></ItemArray></ActiveList>
  <SoldList>
    <OrderTransactionArray>
      <OrderTransaction>
        <Transaction>
          <Item><ItemID>111</ItemID></Item>
          <QuantityPurchased>1</QuantityPurchased>
          <TransactionPrice>10</TransactionPrice>
        </Transaction>
      </OrderTransaction>
      <OrderTransaction>
        <Transaction>
          <Item><ItemID>111</ItemID></Item>
          <QuantityPurchased>1</QuantityPurchased>
          <TransactionPrice>10</TransactionPrice>
        </Transaction>
      </OrderTransaction>
    </OrderTransactionArray>
  </SoldList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const snapshot = await getSellingSnapshot('access-token');

    expect(snapshot.soldItems).toEqual([{ itemId: '111', quantitySold: 2, revenue: 20 }]);
  });

  it('ritorna array vuoti se non ci sono inserzioni né vendite', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <ActiveList></ActiveList>
  <SoldList></SoldList>
</GetMyeBaySellingResponse>`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const snapshot = await getSellingSnapshot('access-token');

    expect(snapshot).toEqual({ listings: [], soldItems: [] });
  });
});
