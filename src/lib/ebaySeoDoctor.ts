import { getCategoryAspects, CategoryAspect } from './ebayTaxonomy';
import { fetchListingData } from './ebayLazarus';

export interface SeoDoctorResult {
  missingRequired: string[];
  missingRecommended: string[];
  totalAspects: number;
  currentAspectsCount: number;
}

/**
 * SEO Doctor Module
 * Analyzes a listing's item specifics against eBay's taxonomy requirements.
 * Missing item specifics are a primary reason for 0 views (Cassini filter out).
 */
export async function analyzeSeoSpecifics(
  accessToken: string,
  ebayItemId: string,
  categoryId: string
): Promise<SeoDoctorResult | null> {
  const [listingData, taxonomy] = await Promise.all([
    fetchListingData(accessToken, ebayItemId),
    getCategoryAspects(accessToken, categoryId)
  ]);

  if (!listingData || !taxonomy) return null;

  const currentNamesLower = new Set(listingData.itemSpecifics.map(s => s.name.toLowerCase()));

  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  for (const aspect of taxonomy.aspects) {
    const nameLower = aspect.localizedAspectName.toLowerCase();
    if (!currentNamesLower.has(nameLower)) {
      if (aspect.aspectConstraint.aspectRequired || aspect.aspectConstraint.aspectUsage === 'REQUIRED') {
        missingRequired.push(aspect.localizedAspectName);
      } else if (aspect.aspectConstraint.aspectUsage === 'RECOMMENDED') {
        missingRecommended.push(aspect.localizedAspectName);
      }
    }
  }

  return {
    missingRequired,
    missingRecommended,
    totalAspects: taxonomy.aspects.length,
    currentAspectsCount: listingData.itemSpecifics.length,
  };
}
