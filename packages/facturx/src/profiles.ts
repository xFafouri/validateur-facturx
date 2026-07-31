/**
 * Factur-X profiles.
 *
 * The profile is declared inside the CII XML at
 * `ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID` and determines which
 * subset of EN 16931 the document promises to satisfy. Declaring a richer profile than the data
 * actually supports is one of the most common causes of rejection, because validators then enforce
 * fields the sender never populated.
 *
 * Source: FNFE-MPE Factur-X specification 1.0.07. Verify against the current specification before
 * go-live - see the accuracy note in the project brief.
 */

export const FACTURX_PROFILES = ['MINIMUM', 'BASIC_WL', 'BASIC', 'EN_16931', 'EXTENDED'] as const;

export type FacturxProfile = (typeof FACTURX_PROFILES)[number];

/**
 * Guideline URNs, keyed by profile.
 *
 * Note the inconsistent shape: `MINIMUM` and `BASIC_WL` use the `factur-x.eu` namespace directly,
 * `BASIC` and `EXTENDED` express themselves as CIUS/extension of the EN 16931 URN, and `EN_16931`
 * is the bare CEN URN. This irregularity is in the specification, not a transcription error.
 */
export const PROFILE_URNS: Record<FacturxProfile, string> = {
  MINIMUM: 'urn:factur-x.eu:1p0:minimum',
  BASIC_WL: 'urn:factur-x.eu:1p0:basicwl',
  BASIC: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
  EN_16931: 'urn:cen.eu:en16931:2017',
  EXTENDED: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
};

/** Reverse lookup, built once. */
const URN_TO_PROFILE: ReadonlyMap<string, FacturxProfile> = new Map(
  (Object.entries(PROFILE_URNS) as [FacturxProfile, string][]).map(([profile, urn]) => [
    urn.toLowerCase(),
    profile,
  ]),
);

/** Ordered weakest to richest, for comparisons like "is this at least BASIC?". */
const PROFILE_RANK: Record<FacturxProfile, number> = {
  MINIMUM: 0,
  BASIC_WL: 1,
  BASIC: 2,
  EN_16931: 3,
  EXTENDED: 4,
};

export interface ProfileInfo {
  readonly profile: FacturxProfile;
  /** French label as used in FNFE-MPE material. */
  readonly label: string;
  /** Plain-French description of what the profile is for. */
  readonly description: string;
  /**
   * Whether the profile carries per-rate VAT detail sufficient for a VAT-registered French
   * business to issue a compliant invoice with it.
   */
  readonly suitableForVatRegistered: boolean;
  /** Whether the profile is expected to carry a human-readable rendition of the invoice. */
  readonly hasVisualLayer: boolean;
}

export const PROFILE_INFO: Record<FacturxProfile, ProfileInfo> = {
  MINIMUM: {
    profile: 'MINIMUM',
    label: 'MINIMUM',
    description:
      "Ne contient que les données d'en-tête et les totaux, sans détail de TVA par taux ni lignes de facture. Conçu pour le pilotage comptable, pas pour tenir lieu de facture.",
    suitableForVatRegistered: false,
    hasVisualLayer: true,
  },
  BASIC_WL: {
    profile: 'BASIC_WL',
    label: 'BASIC WL (without lines)',
    description:
      'Totaux et ventilation de TVA, mais sans les lignes de facture (« without lines »). Destiné aux flux entièrement automatisés entre systèmes.',
    suitableForVatRegistered: false,
    hasVisualLayer: true,
  },
  BASIC: {
    profile: 'BASIC',
    label: 'BASIC',
    description:
      "Lignes de facture et ventilation de TVA complètes. C'est le profil recommandé par défaut pour une TPE ou une PME : il passe la validation le plus largement tout en restant une facture complète.",
    suitableForVatRegistered: true,
    hasVisualLayer: true,
  },
  EN_16931: {
    profile: 'EN_16931',
    label: 'EN 16931 (Comfort)',
    description:
      "Couvre l'intégralité de la norme sémantique européenne EN 16931. Plus riche que BASIC, mais tout champ requis manquant devient une erreur bloquante.",
    suitableForVatRegistered: true,
    hasVisualLayer: true,
  },
  EXTENDED: {
    profile: 'EXTENDED',
    label: 'EXTENDED',
    description:
      "Sur-ensemble de l'EN 16931 autorisant des données supplémentaires (multi-livraisons, informations sectorielles). Base de l'extension française CIUS-FR.",
    suitableForVatRegistered: true,
    hasVisualLayer: true,
  },
};

/**
 * Resolves a guideline URN to a profile.
 *
 * Matching is exact (case-insensitively) rather than substring-based on purpose: `EN_16931` and
 * `BASIC` share the `urn:cen.eu:en16931:2017` prefix, so a "starts with" test would silently
 * misidentify every BASIC document as EN 16931.
 */
export function profileFromUrn(urn: string | null | undefined): FacturxProfile | null {
  if (!urn) return null;
  return URN_TO_PROFILE.get(urn.trim().toLowerCase()) ?? null;
}

/** True when `profile` is at least as rich as `minimum`. */
export function profileAtLeast(profile: FacturxProfile, minimum: FacturxProfile): boolean {
  return PROFILE_RANK[profile] >= PROFILE_RANK[minimum];
}

/**
 * Whether a profile's monetary summation can carry the prepaid amount (BT-113).
 *
 * `MINIMUM` cannot: its summation is reduced to BT-106/109/110/112/115 with no prepaid element at
 * all. An invoice settled partly by a deposit therefore shows a legitimate gap between the total
 * including VAT (BT-112) and the amount due (BT-115) that no field in the document can explain.
 *
 * This matters because BR-CO-16 tests exactly that difference. Applying it to a MINIMUM document
 * reports an error on an invoice that conforming validators accept - verified against a published
 * French MINIMUM sample, which Mustangproject validates as valid while carrying a 201,00 € gap.
 */
export function profileCanExpressPrepaidAmount(profile: FacturxProfile | null): boolean {
  return profile !== 'MINIMUM';
}

/** Whether a profile carries line-level detail (BG-25). `MINIMUM` and `BASIC_WL` do not. */
export function profileCarriesLines(profile: FacturxProfile | null): boolean {
  return profile !== 'MINIMUM' && profile !== 'BASIC_WL';
}

/**
 * The profile we emit by default.
 *
 * BASIC is chosen over EN 16931 because it clears the widest range of receiving platforms while
 * still carrying line-level and VAT detail. Richer data is retained internally, so raising the
 * emitted profile later is a serialiser change rather than a data migration.
 */
export const DEFAULT_OUTPUT_PROFILE: FacturxProfile = 'BASIC';
