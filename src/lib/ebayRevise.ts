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
    const errors = parsed?.ReviseItemResponse?.Errors;
    let message = 'risposta eBay non valida';
    if (Array.isArray(errors)) {
      message = errors.map((e: any) => e.LongMessage || e.ShortMessage).join(' | ');
    } else if (errors) {
      message = errors.LongMessage || errors.ShortMessage || JSON.stringify(errors);
    }
    throw new Error(`ReviseItem ha restituito un errore: ${message}`);
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

interface EbaySpec {
  Name: string;
  Value: string | string[];
}

interface ItemDetails {
  conditionId: string | null;
  title: string;
  specifics: EbaySpec[];
}

async function getExistingItemDetails(accessToken: string, itemId: string): Promise<ItemDetails | null> {
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
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
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const item = parsed?.GetItemResponse?.Item;
  if (!item) return null;

  return {
    conditionId: item.ConditionID ? String(item.ConditionID) : null,
    title: item.Title ? String(item.Title) : '',
    specifics: toArray(item.ItemSpecifics?.NameValueList),
  };
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
      let catXml = `<PrimaryCategory><CategoryID>${proposedValue}</CategoryID></PrimaryCategory>`;
      
      const details = await getExistingItemDetails(accessToken, itemId);
      
      // Gestione ConditionID
      const conditionId = details?.conditionId || '1000';
      catXml += `\n    <ConditionID>${conditionId}</ConditionID>`;

      // Gestione Item Specifics (Marca e Tipo obbligatori per sbloccare categorie rigide come Lampade)
      const list = details?.specifics ? [...details.specifics] : [];
      const hasBrand = list.some(spec => {
        const n = String(spec.Name).toLowerCase();
        return n === 'marca' || n === 'brand';
      });
      const hasType = list.some(spec => {
        const n = String(spec.Name).toLowerCase();
        return n === 'tipo' || n === 'type';
      });

      if (!hasBrand) {
        list.push({ Name: 'Marca', Value: 'Senza marca' });
      }

      if (!hasType) {
        const titleLower = (details?.title || '').toLowerCase();
        let tipoVal = 'Altro';
        if (titleLower.includes('lampada') || titleLower.includes('lamp')) {
          tipoVal = 'Lampada';
        } else if (titleLower.includes('cover') || titleLower.includes('custodia') || titleLower.includes('case')) {
          tipoVal = 'Custodia';
        }
        list.push({ Name: 'Tipo', Value: tipoVal });
      }

      // Ricostruiamo l'XML di ItemSpecifics per inviarlo ad eBay senza perdere i vecchi valori
      const specsXmlList = list.map(spec => {
        const name = escapeXml(String(spec.Name));
        const vals = toArray(spec.Value).map(v => `<Value>${escapeXml(String(v))}</Value>`).join('');
        return `
      <NameValueList>
        <Name>${name}</Name>
        ${vals}
      </NameValueList>`;
      });

      catXml += `\n    <ItemSpecifics>${specsXmlList.join('')}\n    </ItemSpecifics>`;

      await reviseListingField(accessToken, itemId, catXml);
      return;
    default:
      throw new Error(`Applicazione automatica non supportata per il campo "${field}"`);
  }
}
