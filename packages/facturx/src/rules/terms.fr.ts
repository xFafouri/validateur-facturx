/**
 * French glossary of EN 16931 business terms (`BT-*`) and business groups (`BG-*`).
 *
 * Validator messages are written in the vocabulary of the standard: "Sum of Invoice line net
 * amount (BT-106) = Σ Invoice line net amount (BT-131)". That sentence is precise and completely
 * opaque to the person who has to act on it. This glossary is what turns `BT-106` back into
 * "total HT de la facture" in the interface.
 *
 * Labels follow the French translation of EN 16931 as used in FNFE-MPE material.
 */

export interface BusinessTerm {
  /** Identifier, e.g. `BT-106`. */
  readonly id: string;
  /** Short French label. */
  readonly label: string;
  /** Where the value is normally found on a paper invoice, in everyday language. */
  readonly plain: string;
}

const TERMS: readonly BusinessTerm[] = [
  // --- Document identification -------------------------------------------------
  {
    id: 'BT-1',
    label: 'Numéro de facture',
    plain: 'Le numéro unique de la facture, séquentiel et sans trou.',
  },
  { id: 'BT-2', label: "Date d'émission", plain: 'La date à laquelle la facture est établie.' },
  { id: 'BT-3', label: 'Code type de facture', plain: '380 pour une facture, 381 pour un avoir.' },
  { id: 'BT-5', label: 'Code devise', plain: 'La devise de la facture, EUR en France.' },
  { id: 'BT-9', label: "Date d'échéance", plain: 'La date limite de paiement.' },
  {
    id: 'BT-10',
    label: 'Référence acheteur',
    plain:
      "La référence que l'acheteur vous a demandé de rappeler (bon de commande, code service).",
  },
  {
    id: 'BT-13',
    label: 'Numéro de bon de commande',
    plain: "Le numéro du bon de commande de l'acheteur.",
  },
  {
    id: 'BT-22',
    label: 'Note de facture',
    plain: 'Les mentions libres : pénalités de retard, escompte, indemnité de recouvrement.',
  },
  {
    id: 'BT-23',
    label: 'Identifiant du processus métier',
    plain: 'Le type de flux commercial déclaré.',
  },
  {
    id: 'BT-24',
    label: 'Identifiant de spécification',
    plain: "L'URN qui déclare le profil Factur-X utilisé.",
  },

  // --- Seller ------------------------------------------------------------------
  { id: 'BT-27', label: 'Nom du vendeur', plain: 'La raison sociale de votre entreprise.' },
  {
    id: 'BT-29',
    label: 'Identifiant électronique du vendeur',
    plain: "L'adresse électronique de routage du vendeur (SIRET dans l'Annuaire).",
  },
  {
    id: 'BT-30',
    label: 'Identifiant légal du vendeur',
    plain: 'Le SIREN ou SIRET de votre entreprise.',
  },
  {
    id: 'BT-31',
    label: 'Numéro de TVA du vendeur',
    plain: 'Votre numéro de TVA intracommunautaire (FR + clé + SIREN).',
  },
  {
    id: 'BT-32',
    label: 'Identifiant fiscal du vendeur',
    plain: 'Un identifiant fiscal complémentaire, hors TVA.',
  },
  {
    id: 'BT-34',
    label: 'Adresse électronique du vendeur',
    plain: "L'adresse électronique du vendeur au sens de l'Annuaire.",
  },
  { id: 'BT-35', label: 'Adresse du vendeur - ligne 1', plain: 'Numéro et rue du vendeur.' },
  { id: 'BT-37', label: 'Ville du vendeur', plain: 'La commune du vendeur.' },
  { id: 'BT-38', label: 'Code postal du vendeur', plain: 'Le code postal du vendeur.' },
  { id: 'BT-40', label: 'Code pays du vendeur', plain: 'Le pays du vendeur, FR pour la France.' },

  // --- Buyer -------------------------------------------------------------------
  { id: 'BT-44', label: "Nom de l'acheteur", plain: 'La raison sociale de votre client.' },
  {
    id: 'BT-46',
    label: "Identifiant électronique de l'acheteur",
    plain:
      "L'adresse électronique de routage de l'acheteur - c'est elle qui permet d'acheminer la facture.",
  },
  {
    id: 'BT-47',
    label: "Identifiant légal de l'acheteur",
    plain: 'Le SIREN ou SIRET de votre client.',
  },
  {
    id: 'BT-48',
    label: "Numéro de TVA de l'acheteur",
    plain: 'Le numéro de TVA intracommunautaire de votre client.',
  },
  {
    id: 'BT-49',
    label: "Adresse électronique de l'acheteur",
    plain: "L'adresse électronique de l'acheteur au sens de l'Annuaire.",
  },
  { id: 'BT-50', label: "Adresse de l'acheteur - ligne 1", plain: "Numéro et rue de l'acheteur." },
  { id: 'BT-52', label: "Ville de l'acheteur", plain: "La commune de l'acheteur." },
  { id: 'BT-53', label: "Code postal de l'acheteur", plain: "Le code postal de l'acheteur." },
  {
    id: 'BT-55',
    label: "Code pays de l'acheteur",
    plain: "Le pays de l'acheteur, FR pour la France.",
  },

  // --- Delivery ----------------------------------------------------------------
  {
    id: 'BT-72',
    label: 'Date de livraison effective',
    plain: 'La date à laquelle le bien ou le service a été livré.',
  },

  // --- Payment -----------------------------------------------------------------
  {
    id: 'BT-81',
    label: 'Code du moyen de paiement',
    plain: 'Comment la facture doit être réglée (virement, prélèvement, carte).',
  },
  {
    id: 'BT-84',
    label: 'IBAN du compte à créditer',
    plain: "L'IBAN sur lequel votre client doit payer.",
  },

  // --- Totals ------------------------------------------------------------------
  {
    id: 'BT-106',
    label: 'Total HT des lignes',
    plain: 'La somme des montants HT de toutes les lignes, avant remises et frais globaux.',
  },
  {
    id: 'BT-107',
    label: 'Total des remises',
    plain: 'Le total des remises appliquées au niveau de la facture.',
  },
  {
    id: 'BT-108',
    label: 'Total des frais',
    plain: 'Le total des frais appliqués au niveau de la facture.',
  },
  {
    id: 'BT-109',
    label: 'Total HT de la facture',
    plain: 'Le montant hors taxes à payer, après remises et frais.',
  },
  { id: 'BT-110', label: 'Total TVA', plain: 'Le montant total de la TVA.' },
  {
    id: 'BT-111',
    label: 'Total TVA en devise comptable',
    plain: 'Le total de TVA converti dans la devise de comptabilisation.',
  },
  { id: 'BT-112', label: 'Total TTC', plain: 'Le montant toutes taxes comprises.' },
  { id: 'BT-113', label: 'Montant déjà payé', plain: 'Les acomptes déjà réglés.' },
  { id: 'BT-114', label: 'Montant arrondi', plain: "L'ajustement d'arrondi éventuel." },
  { id: 'BT-115', label: 'Net à payer', plain: 'Ce que votre client doit effectivement régler.' },

  // --- VAT breakdown -----------------------------------------------------------
  {
    id: 'BT-116',
    label: 'Base HT par taux',
    plain: 'Le montant HT soumis à un taux de TVA donné.',
  },
  { id: 'BT-117', label: 'Montant de TVA par taux', plain: 'La TVA calculée pour ce taux.' },
  {
    id: 'BT-118',
    label: 'Code catégorie de TVA',
    plain:
      'S (taux normal), Z (taux zéro), E (exonéré), AE (autoliquidation), K (intracommunautaire), G (export).',
  },
  {
    id: 'BT-119',
    label: 'Taux de TVA',
    plain: 'Le pourcentage appliqué : 20, 10, 5.5 ou 2.1 en France.',
  },
  {
    id: 'BT-120',
    label: "Motif d'exonération",
    plain: "La mention légale justifiant l'absence de TVA.",
  },
  {
    id: 'BT-121',
    label: "Code du motif d'exonération",
    plain: "Le code normalisé du motif d'exonération.",
  },

  // --- Lines -------------------------------------------------------------------
  { id: 'BT-126', label: 'Identifiant de ligne', plain: 'Le numéro de la ligne dans la facture.' },
  { id: 'BT-129', label: 'Quantité facturée', plain: 'La quantité vendue sur cette ligne.' },
  {
    id: 'BT-130',
    label: 'Unité de mesure',
    plain: "L'unité de la quantité : C62 pour une pièce, HUR pour une heure, DAY pour un jour.",
  },
  {
    id: 'BT-131',
    label: 'Montant HT de la ligne',
    plain: 'Le montant hors taxes de cette ligne. La somme de ces montants doit égaler le BT-106.',
  },
  {
    id: 'BT-146',
    label: 'Prix unitaire net',
    plain: 'Le prix unitaire hors taxes, remise déduite.',
  },
  {
    id: 'BT-151',
    label: 'Code catégorie de TVA de la ligne',
    plain: 'La catégorie de TVA appliquée à cette ligne.',
  },
  {
    id: 'BT-152',
    label: 'Taux de TVA de la ligne',
    plain: 'Le taux de TVA appliqué à cette ligne.',
  },
  {
    id: 'BT-153',
    label: 'Nom de l’article',
    plain: 'La désignation du produit ou de la prestation.',
  },
  {
    id: 'BT-154',
    label: "Description de l'article",
    plain: 'Le détail du produit ou de la prestation.',
  },

  // --- Groups ------------------------------------------------------------------
  { id: 'BG-1', label: 'Note de facture', plain: 'Le bloc des mentions libres de la facture.' },
  { id: 'BG-6', label: 'Contact vendeur', plain: 'Le bloc des coordonnées de contact du vendeur.' },
  { id: 'BG-14', label: 'Période de facturation', plain: 'La période couverte par la facture.' },
  { id: 'BG-16', label: 'Instructions de paiement', plain: 'Le bloc décrivant comment payer.' },
  { id: 'BG-22', label: 'Totaux du document', plain: 'Le bloc des totaux de la facture.' },
  { id: 'BG-23', label: 'Ventilation de TVA', plain: 'Le bloc détaillant la TVA par taux.' },
  { id: 'BG-25', label: 'Ligne de facture', plain: 'Le bloc décrivant une ligne.' },
  { id: 'BG-26', label: 'Période de la ligne', plain: 'La période couverte par une ligne.' },
];

const TERM_INDEX: ReadonlyMap<string, BusinessTerm> = new Map(
  TERMS.map((term) => [term.id.toUpperCase(), term]),
);

export function lookupTerm(id: string): BusinessTerm | null {
  return TERM_INDEX.get(id.trim().toUpperCase()) ?? null;
}

/** Every `BT-*`/`BG-*` identifier mentioned in a message, de-duplicated and in order of appearance. */
export function termsInMessage(message: string): BusinessTerm[] {
  const found: BusinessTerm[] = [];
  const seen = new Set<string>();
  for (const match of message.matchAll(/\b(B[TG]-\d+)\b/gi)) {
    const id = match[1]?.toUpperCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const term = lookupTerm(id);
    if (term) found.push(term);
  }
  return found;
}

export const ALL_TERMS = TERMS;
