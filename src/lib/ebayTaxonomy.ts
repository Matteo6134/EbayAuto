export interface CategoryAspect {
  localizedAspectName: string;
  aspectConstraint: {
    aspectRequired: boolean;
    aspectUsage: 'RECOMMENDED' | 'OPTIONAL' | 'REQUIRED';
    itemToAspectCardinality: 'SINGLE' | 'MULTI';
  };
  aspectValues?: Array<{
    localizedValue: string;
  }>;
}

export interface CategoryAspectsResult {
  categoryId: string;
  categoryName: string;
  aspects: CategoryAspect[];
  requiredAspects: CategoryAspect[];
}

/**
 * Uses the eBay Taxonomy REST API to fetch all aspects (item specifics) for a
 * given category, including which are required/recommended, and what valid values exist.
 * This is used to pre-fill required specifics before applying category changes via ReviseItem.
 */
export async function getCategoryAspects(
  accessToken: string,
  categoryId: string
): Promise<CategoryAspectsResult | null> {
  // The eBay Taxonomy API endpoint for Italy (site ID 101 → EBAY_IT)
  const url = `https://api.ebay.com/commerce/taxonomy/v1/category_tree/101/get_item_aspects_for_category?category_id=${categoryId}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    console.error(`getCategoryAspects failed for category ${categoryId}: HTTP ${res.status}`);
    return null;
  }

  const data = await res.json();
  const aspects: CategoryAspect[] = (data.aspects ?? []).map((a: any) => ({
    localizedAspectName: a.localizedAspectName,
    aspectConstraint: {
      aspectRequired: a.aspectConstraint?.aspectRequired ?? false,
      aspectUsage: a.aspectConstraint?.aspectUsage ?? 'OPTIONAL',
      itemToAspectCardinality: a.aspectConstraint?.itemToAspectCardinality ?? 'SINGLE',
    },
    aspectValues: (a.aspectValues ?? []).map((v: any) => ({
      localizedValue: v.localizedValue,
    })),
  }));

  return {
    categoryId,
    categoryName: data.categoryName ?? '',
    aspects,
    requiredAspects: aspects.filter(
      (a) => a.aspectConstraint.aspectRequired || a.aspectConstraint.aspectUsage === 'REQUIRED'
    ),
  };
}

/**
 * Returns just the required aspect names mapped to their first valid value.
 * This is used as a "best-effort" approach to pre-fill missing required specifics.
 */
export function buildMinimalSpecifics(
  result: CategoryAspectsResult,
  existingSpecNames: string[]
): Array<{ Name: string; Value: string }> {
  const existingLower = new Set(existingSpecNames.map((n) => n.toLowerCase()));
  const toAdd: Array<{ Name: string; Value: string }> = [];

  for (const aspect of result.requiredAspects) {
    const nameLower = aspect.localizedAspectName.toLowerCase();
    if (existingLower.has(nameLower)) continue;

    // Use first valid value if available, otherwise use a sensible fallback
    const firstValue = aspect.aspectValues?.[0]?.localizedValue;
    if (firstValue) {
      toAdd.push({ Name: aspect.localizedAspectName, Value: firstValue });
    } else if (nameLower === 'marca' || nameLower === 'brand') {
      toAdd.push({ Name: aspect.localizedAspectName, Value: 'Senza marca' });
    } else if (nameLower === 'condizione' || nameLower === 'condition') {
      toAdd.push({ Name: aspect.localizedAspectName, Value: 'Nuovo' });
    }
  }

  return toAdd;
}
