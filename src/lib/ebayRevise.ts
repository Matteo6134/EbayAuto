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

export function escapeXml(unsafe: string): string {
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

export async function getExistingItemDetails(accessToken: string, itemId: string): Promise<ItemDetails | null> {
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
    case 'title': {
      // limit title to 80 chars
      const newTitle = escapeXml(proposedValue.substring(0, 80));
      await reviseListingField(accessToken, itemId, `<Title>${newTitle}</Title>`);
      return;
    }
    case 'category': {
      let catXml = `<PrimaryCategory><CategoryID>${proposedValue}</CategoryID></PrimaryCategory>`;
      
      const details = await getExistingItemDetails(accessToken, itemId);
      
      // Gestione ConditionID obbligatoria
      const conditionId = details?.conditionId || '1000';
      catXml += `\n    <ConditionID>${conditionId}</ConditionID>`;

      // Usa la Taxonomy API per sapere ESATTAMENTE quali specifiche sono obbligatorie
      // per la nuova categoria e compilarle automaticamente con valori validi
      const existingSpecNames = (details?.specifics ?? []).map((s) => String(s.Name));
      
      let list = details?.specifics ? [...details.specifics] : [];
      
      try {
        const { getCategoryAspects, buildMinimalSpecifics } = await import('./ebayTaxonomy');
        const taxonomyResult = await getCategoryAspects(accessToken, proposedValue);
        if (taxonomyResult) {
          const missing = buildMinimalSpecifics(taxonomyResult, existingSpecNames);
          for (const spec of missing) {
            list.push({ Name: spec.Name, Value: spec.Value });
          }
        }
      } catch (taxonomyError) {
        console.warn('Taxonomy API not available, using fallback specifics logic:', taxonomyError);
        // Fallback: ensure Marca and Tipo are present at minimum
        const hasBrand = list.some(s => ['marca', 'brand'].includes(String(s.Name).toLowerCase()));
        const hasType = list.some(s => ['tipo', 'type'].includes(String(s.Name).toLowerCase()));
        if (!hasBrand) list.push({ Name: 'Marca', Value: 'Senza marca' });
        if (!hasType) {
          const tl = (details?.title || '').toLowerCase();
          const tipo = tl.includes('lamp') ? 'Lampada' : tl.includes('case') || tl.includes('cover') ? 'Custodia' : 'Altro';
          list.push({ Name: 'Tipo', Value: tipo });
        }
      }

      // Ricostruisce XML ItemSpecifics
      const specsXmlList = list.map((spec) => {
        const name = escapeXml(String(spec.Name));
        const vals = toArray(spec.Value)
          .map((v) => `<Value>${escapeXml(String(v))}</Value>`)
          .join('');
        return `\n      <NameValueList><Name>${name}</Name>${vals}</NameValueList>`;
      });

      if (specsXmlList.length > 0) {
        catXml += `\n    <ItemSpecifics>${specsXmlList.join('')}\n    </ItemSpecifics>`;
      }

      await reviseListingField(accessToken, itemId, catXml);
      return;
    }
    default:
      throw new Error(`Applicazione automatica non supportata per il campo "${field}"`);
  }
}

/**
 * eBay's ReviseItem replaces the ENTIRE <ItemSpecifics> block on every call, so we
 * must fetch the existing specifics first and merge the new values in (new values
 * override existing ones with the same name, case-insensitive) before sending.
 */
export async function reviseItemSpecifics(
  accessToken: string,
  itemId: string,
  newSpecifics: Record<string, string>
): Promise<void> {
  const details = await getExistingItemDetails(accessToken, itemId);
  const existing = details?.specifics ?? [];

  const merged = new Map<string, { name: string; value: string }>();
  for (const spec of existing) {
    const name = String(spec.Name);
    const value = toArray(spec.Value).map((v) => String(v)).join(', ');
    merged.set(name.toLowerCase(), { name, value });
  }
  for (const [name, value] of Object.entries(newSpecifics)) {
    merged.set(name.toLowerCase(), { name, value });
  }

  const specsXmlList = Array.from(merged.values()).map(({ name, value }) => {
    return `\n      <NameValueList><Name>${escapeXml(name)}</Name><Value>${escapeXml(value)}</Value></NameValueList>`;
  });

  const specificsXml = `<ItemSpecifics>${specsXmlList.join('')}\n    </ItemSpecifics>`;

  await reviseListingField(accessToken, itemId, specificsXml);
}
