/**
 * Plain-French explanations of the validation rules.
 *
 * This is the product, not a nicety. A raw validator tells a user
 * "[BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131)", which
 * states the rule but not what went wrong, why it usually goes wrong, or what to change. Every
 * entry here answers those three questions in the language of someone running a small business.
 *
 * Each explanation carries:
 *  - `title`   a one-line statement of the problem
 *  - `meaning` what the rule actually requires
 *  - `cause`   why it typically fails in practice
 *  - `fix`     the concrete action to take
 *
 * Coverage is deliberately partial and prioritised: the rules that actually fire on real invoices
 * are written out individually, and family-level fallbacks (below) cover the long tail so an
 * unrecognised rule still degrades to something useful rather than to a bare identifier.
 *
 * Rule semantics follow EN 16931 and the DGFiP Flux 2 Schematron. Verify against the current
 * specification before go-live - see the accuracy note in the project brief.
 */

import type { Ruleset, Severity } from '../engine/types.js';

export interface RuleExplanation {
  readonly id: string;
  readonly title: string;
  readonly meaning: string;
  readonly cause: string;
  readonly fix: string;
  /**
   * Whether this rule applies to a French domestic B2B invoice.
   *
   * `false` for German XRechnung rules, which the engine evaluates regardless of the document's
   * origin. Surfacing those as problems would send users chasing obligations they do not have.
   */
  readonly appliesInFrance: boolean;
}

type CatalogueEntry = Omit<RuleExplanation, 'id' | 'appliesInFrance'> & {
  readonly appliesInFrance?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Mandatory content (BR-01 … BR-16)                                          */
/* -------------------------------------------------------------------------- */

const MANDATORY: Record<string, CatalogueEntry> = {
  'BR-01': {
    title: "L'identifiant de spécification est absent",
    meaning:
      "Toute facture doit déclarer le profil Factur-X qu'elle respecte (BT-24), sous forme d'une URN normalisée.",
    cause:
      "Le logiciel émetteur n'a pas renseigné l'élément GuidelineSpecifiedDocumentContextParameter, ou a écrit une URN approximative.",
    fix: "Renseignez l'URN exacte du profil, par exemple « urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic » pour le profil BASIC. La moindre différence de casse ou d'espace invalide la facture.",
  },
  'BR-02': {
    title: 'Le numéro de facture est absent',
    meaning: 'Toute facture doit porter un numéro unique (BT-1).',
    cause: 'Le champ numéro est vide, ou la facture a été générée en brouillon sans numérotation.',
    fix: 'Attribuez un numéro unique et séquentiel. Le Code général des impôts impose une numérotation continue, sans rupture ni doublon.',
  },
  'BR-03': {
    title: "La date d'émission est absente",
    meaning: "Toute facture doit porter une date d'émission (BT-2).",
    cause: 'La date est vide, ou transmise dans un format que le standard ne reconnaît pas.',
    fix: 'Renseignez la date au format CCYYMMDD avec l\'attribut format="102", par exemple 20260901 pour le 1er septembre 2026.',
  },
  'BR-04': {
    title: 'Le code type de facture est absent',
    meaning: 'Toute facture doit déclarer sa nature via un code (BT-3).',
    cause: "Le code n'a pas été émis, ou une valeur hors liste a été utilisée.",
    fix: 'Utilisez 380 pour une facture, 381 pour un avoir, 384 pour une facture rectificative, 389 pour une autofacturation.',
  },
  'BR-05': {
    title: 'Le code devise est absent',
    meaning: 'Toute facture doit déclarer sa devise (BT-5).',
    cause: 'La devise est implicite dans le logiciel émetteur et n’a pas été écrite dans le XML.',
    fix: 'Renseignez le code ISO 4217, soit EUR pour une facture en euros.',
  },
  'BR-06': {
    title: 'Le nom du vendeur est absent',
    meaning: 'Toute facture doit indiquer la raison sociale du vendeur (BT-27).',
    cause: 'La fiche entreprise est incomplète dans le logiciel émetteur.',
    fix: "Renseignez la dénomination sociale exacte, telle qu'inscrite au registre du commerce.",
  },
  'BR-07': {
    title: "Le nom de l'acheteur est absent",
    meaning: "Toute facture doit indiquer la raison sociale de l'acheteur (BT-44).",
    cause: 'La fiche client est incomplète.',
    fix: 'Renseignez la dénomination sociale exacte de votre client.',
  },
  'BR-08': {
    title: "L'adresse postale du vendeur est absente",
    meaning: 'Toute facture doit comporter le bloc adresse du vendeur (BG-5).',
    cause: 'Le bloc PostalTradeAddress est vide ou absent.',
    fix: 'Renseignez au minimum la ville, le code postal et le code pays du vendeur.',
  },
  'BR-09': {
    title: 'Le code pays du vendeur est absent',
    meaning: "L'adresse du vendeur doit comporter un code pays (BT-40).",
    cause: "Le pays est sous-entendu et n'a pas été écrit.",
    fix: 'Renseignez le code ISO 3166-1 alpha-2, soit FR pour la France.',
  },
  'BR-10': {
    title: "L'adresse postale de l'acheteur est absente",
    meaning: "Toute facture doit comporter le bloc adresse de l'acheteur (BG-8).",
    cause: 'La fiche client ne contient pas d’adresse structurée.',
    fix: "Renseignez au minimum la ville, le code postal et le code pays de l'acheteur.",
  },
  'BR-11': {
    title: "Le code pays de l'acheteur est absent",
    meaning: "L'adresse de l'acheteur doit comporter un code pays (BT-55).",
    cause: "Le pays est sous-entendu et n'a pas été écrit.",
    fix: 'Renseignez le code ISO 3166-1 alpha-2, soit FR pour un client français.',
  },
  'BR-12': {
    title: 'Le total HT des lignes est absent',
    meaning: 'Toute facture doit porter la somme des montants HT de ses lignes (BT-106).',
    cause: 'Le bloc de totaux a été émis partiellement.',
    fix: 'Renseignez LineTotalAmount avec la somme exacte des montants HT de toutes les lignes.',
  },
  'BR-13': {
    title: 'Le total HT de la facture est absent',
    meaning: 'Toute facture doit porter son montant hors taxes (BT-109).',
    cause: 'Le bloc de totaux a été émis partiellement.',
    fix: 'Renseignez TaxBasisTotalAmount : total des lignes, moins les remises, plus les frais.',
  },
  'BR-14': {
    title: 'Le total TTC est absent',
    meaning: 'Toute facture doit porter son montant toutes taxes comprises (BT-112).',
    cause: 'Le bloc de totaux a été émis partiellement.',
    fix: 'Renseignez GrandTotalAmount, égal au total HT augmenté de la TVA.',
  },
  'BR-15': {
    title: 'Le net à payer est absent',
    meaning: 'Toute facture doit indiquer le montant réellement dû (BT-115).',
    cause: "Le champ est omis lorsqu'il est identique au TTC, alors qu'il reste obligatoire.",
    fix: "Renseignez DuePayableAmount, même s'il est égal au total TTC.",
  },
  'BR-16': {
    title: 'La facture ne comporte aucune ligne',
    meaning: 'Toute facture doit comporter au moins une ligne de facturation (BG-25).',
    cause:
      "La facture a été générée sans détail, ou le profil MINIMUM/BASIC WL a été utilisé alors qu'il ne porte pas de lignes.",
    fix: 'Ajoutez au moins une ligne. Si vous utilisez MINIMUM ou BASIC WL, passez au profil BASIC : ces deux profils ne conviennent pas à une facture destinée à un client assujetti à la TVA.',
  },
};

/* -------------------------------------------------------------------------- */
/* Arithmetic and consistency (BR-CO-*)                                       */
/* -------------------------------------------------------------------------- */

const ARITHMETIC: Record<string, CatalogueEntry> = {
  'BR-CO-10': {
    title: 'Le total HT des lignes ne correspond pas à la somme des lignes',
    meaning:
      'Le total HT déclaré (BT-106) doit être exactement égal à la somme des montants HT de chaque ligne (BT-131).',
    cause:
      "C'est l'erreur la plus fréquente. Elle vient presque toujours d'un arrondi : le logiciel calcule chaque ligne avec plusieurs décimales, arrondit l'affichage à deux décimales, puis additionne les valeurs non arrondies. L'écart d'un centime suffit à faire rejeter la facture.",
    fix: "Arrondissez chaque ligne à deux décimales d'abord, puis additionnez les valeurs arrondies. N'additionnez jamais les valeurs non arrondies pour les arrondir ensuite : les deux méthodes ne donnent pas le même résultat.",
  },
  'BR-CO-11': {
    title: 'Le total des remises est incohérent',
    meaning:
      'Le total des remises au niveau facture (BT-107) doit égaler la somme des remises détaillées (BT-92).',
    cause: 'Une remise globale a été saisie sans être détaillée, ou inversement.',
    fix: 'Vérifiez que chaque remise figure à la fois dans le détail et dans le total.',
  },
  'BR-CO-12': {
    title: 'Le total des frais est incohérent',
    meaning:
      'Le total des frais au niveau facture (BT-108) doit égaler la somme des frais détaillés (BT-99).',
    cause: 'Des frais de port ont été ajoutés au total sans ligne de frais correspondante.',
    fix: 'Vérifiez que chaque frais figure à la fois dans le détail et dans le total.',
  },
  'BR-CO-13': {
    title: 'Le total HT de la facture est incohérent',
    meaning:
      'Le total HT (BT-109) doit égaler le total des lignes (BT-106), moins les remises (BT-107), plus les frais (BT-108).',
    cause:
      'Une remise ou des frais globaux ont été appliqués au total sans être déclarés dans les champs prévus.',
    fix: 'Recalculez : BT-109 = BT-106 - BT-107 + BT-108. Si vous accordez une remise globale, elle doit figurer en BT-107 et non être déduite silencieusement du total.',
  },
  'BR-CO-14': {
    title: 'Le total de TVA ne correspond pas à la ventilation',
    meaning:
      'Le total de TVA (BT-110) doit égaler la somme des montants de TVA de chaque taux (BT-117).',
    cause:
      'La facture comporte plusieurs taux (20 % et 5,5 % par exemple) et la ventilation ne couvre pas tous les taux, ou un taux apparaît deux fois.',
    fix: 'Établissez exactement un bloc de ventilation par taux de TVA, et vérifiez que leurs montants additionnés donnent le total.',
  },
  'BR-CO-15': {
    title: 'Le total TTC est incohérent',
    meaning:
      'Le total TTC (BT-112) doit égaler le total HT (BT-109) plus le total de TVA (BT-110).',
    cause:
      "Le total TTC a été saisi manuellement, ou provient d'un calcul antérieur à une modification de la facture.",
    fix: 'Recalculez : BT-112 = BT-109 + BT-110.',
  },
  'BR-CO-16': {
    title: 'Le net à payer est incohérent',
    meaning:
      'Le net à payer (BT-115) doit égaler le total TTC (BT-112), moins les acomptes déjà versés (BT-113), plus l’arrondi (BT-114).',
    cause: 'Un acompte a été déduit du net à payer sans être déclaré en BT-113.',
    fix: 'Recalculez : BT-115 = BT-112 - BT-113 + BT-114, et déclarez tout acompte en BT-113.',
  },
  'BR-CO-17': {
    title: 'Un montant de TVA est mal calculé',
    meaning:
      'Pour chaque taux, la TVA (BT-117) doit égaler la base (BT-116) multipliée par le taux (BT-119), divisée par 100 et arrondie à deux décimales.',
    cause: 'Arrondi effectué ligne par ligne plutôt que sur la base totale du taux.',
    fix: 'Calculez la TVA sur la base totale de chaque taux, pas ligne par ligne : BT-117 = arrondi(BT-116 × BT-119 / 100, 2).',
  },
  'BR-CO-18': {
    title: 'La ventilation de TVA est absente',
    meaning: 'Toute facture doit comporter au moins un bloc de ventilation de TVA (BG-23).',
    cause:
      'Le profil MINIMUM a été utilisé, ou la ventilation a été omise sur une facture exonérée.',
    fix: "Ajoutez un bloc de ventilation par taux. Même une facture exonérée doit en comporter un, avec le code catégorie et le motif d'exonération.",
  },
  'BR-CO-25': {
    title: "Ni date d'échéance ni conditions de paiement",
    meaning:
      "Lorsque le net à payer est positif, la facture doit indiquer soit une date d'échéance (BT-9), soit des conditions de paiement (BT-20).",
    cause: "Le logiciel n'a pas transmis l'échéance, souvent parce qu'elle est gérée hors facture.",
    fix: "Renseignez la date d'échéance, ou à défaut les conditions de paiement en texte libre.",
  },
  'BR-CO-03': {
    title: 'Incohérence entre TVA en devise comptable et devise de facturation',
    meaning:
      'Lorsque la devise comptable diffère de la devise de facturation, le total de TVA doit être fourni dans les deux (BT-110 et BT-111).',
    cause: 'Facture émise dans une devise étrangère sans conversion en euros.',
    fix: 'Renseignez le total de TVA converti dans la devise comptable, en euros pour une entreprise française.',
  },
};

/* -------------------------------------------------------------------------- */
/* VAT categories (BR-S/E/Z/AE/G/K/O-*)                                       */
/* -------------------------------------------------------------------------- */

const VAT_CATEGORIES: Record<string, CatalogueEntry> = {
  'BR-S-01': {
    title: 'TVA au taux normal annoncée sans ventilation correspondante',
    meaning:
      'Si une ligne porte la catégorie S (taux normal), la facture doit comporter un bloc de ventilation de TVA pour cette catégorie.',
    cause: 'Les lignes déclarent un taux mais le bloc de synthèse de TVA est absent ou incomplet.',
    fix: 'Ajoutez un bloc de ventilation avec CategoryCode = S et le taux appliqué.',
  },
  'BR-S-08': {
    title: 'Base de TVA au taux normal incohérente',
    meaning:
      'Pour chaque taux en catégorie S, la base (BT-116) doit égaler la somme des montants HT des lignes portant ce taux.',
    cause:
      "Une ligne a été rattachée au mauvais taux, ou une remise globale n'a pas été répercutée sur la base.",
    fix: 'Vérifiez que chaque ligne porte le bon taux, et que la base de chaque taux est la somme des lignes concernées après remises.',
  },
  'BR-S-09': {
    title: 'Montant de TVA au taux normal incohérent',
    meaning: 'La TVA de la catégorie S doit égaler la base multipliée par le taux.',
    cause: 'Erreur d’arrondi ou taux saisi en décimal (0,20) au lieu de pourcentage (20).',
    fix: 'Exprimez le taux en pourcentage : 20 et non 0.20. Recalculez la TVA sur la base totale du taux.',
  },
  'BR-E-01': {
    title: 'Exonération annoncée sans ventilation correspondante',
    meaning:
      'Si une ligne est exonérée (catégorie E), la facture doit comporter un bloc de ventilation pour cette catégorie.',
    cause: "L'exonération a été appliquée sur les lignes sans être reprise en synthèse.",
    fix: 'Ajoutez un bloc de ventilation avec CategoryCode = E.',
  },
  'BR-E-10': {
    title: "Motif d'exonération manquant",
    meaning:
      "Une ventilation en catégorie E doit indiquer le motif d'exonération (BT-120) ou son code (BT-121).",
    cause: "Le motif est imprimé sur le PDF mais n'a pas été transmis dans le XML.",
    fix: 'Renseignez ExemptionReason avec la mention légale, par exemple « TVA non applicable, article 293 B du CGI » pour un micro-entrepreneur en franchise.',
  },
  'BR-AE-01': {
    title: 'Autoliquidation annoncée sans ventilation correspondante',
    meaning:
      "Si une ligne relève de l'autoliquidation (catégorie AE), la facture doit comporter un bloc de ventilation pour cette catégorie.",
    cause:
      'Sous-traitance du bâtiment ou prestation intracommunautaire déclarée seulement sur les lignes.',
    fix: 'Ajoutez un bloc de ventilation avec CategoryCode = AE, taux 0.',
  },
  'BR-AE-10': {
    title: "Mention d'autoliquidation manquante",
    meaning:
      "Une ventilation en catégorie AE doit porter un motif expliquant l'autoliquidation (BT-120).",
    cause: 'La mention figure sur le PDF mais pas dans le XML.',
    fix: "Renseignez ExemptionReason avec « Autoliquidation », mention obligatoire au titre de l'article 283-2 du CGI.",
  },
  'BR-Z-01': {
    title: 'Taux zéro annoncé sans ventilation correspondante',
    meaning:
      'Si une ligne porte un taux zéro (catégorie Z), la facture doit comporter un bloc de ventilation pour cette catégorie.',
    cause: 'Le taux zéro a été appliqué sans reprise en synthèse.',
    fix: 'Ajoutez un bloc de ventilation avec CategoryCode = Z et RateApplicablePercent = 0.',
  },
  'BR-IC-11': {
    title: 'Livraison intracommunautaire sans date de livraison',
    meaning:
      'Une facture en catégorie K (livraison intracommunautaire) doit porter la date de livraison (BT-72) ou la période de facturation.',
    cause: 'La date de livraison est absente sur une opération intracommunautaire.',
    fix: 'Renseignez la date de livraison effective.',
  },
  'BR-IC-12': {
    title: 'Livraison intracommunautaire sans pays de livraison',
    meaning: 'Une facture en catégorie K doit indiquer le pays de livraison.',
    cause: "L'adresse de livraison est absente.",
    fix: 'Renseignez le bloc adresse de livraison avec son code pays.',
  },
  'BR-G-01': {
    title: 'Export hors UE annoncé sans ventilation correspondante',
    meaning:
      "Si une ligne relève de l'export hors UE (catégorie G), la facture doit comporter un bloc de ventilation pour cette catégorie.",
    cause: "L'export a été déclaré sur les lignes sans reprise en synthèse.",
    fix: 'Ajoutez un bloc de ventilation avec CategoryCode = G et le motif « Exportation hors UE ».',
  },
  'BR-O-01': {
    title: 'Non-assujetti annoncé sans ventilation correspondante',
    meaning:
      'Si une ligne relève de la catégorie O (hors champ de la TVA), la facture doit comporter un bloc de ventilation pour cette catégorie.',
    cause: 'Facture émise par un non-assujetti sans ventilation.',
    fix: 'Ajoutez un bloc de ventilation avec CategoryCode = O et le motif correspondant.',
  },
};

/* -------------------------------------------------------------------------- */
/* Code lists (BR-CL-*)                                                       */
/* -------------------------------------------------------------------------- */

const CODE_LISTS: Record<string, CatalogueEntry> = {
  'BR-CL-01': {
    title: 'Identifiant de spécification hors liste',
    meaning: "L'identifiant de spécification (BT-24) doit être une URN reconnue.",
    cause: 'URN mal recopiée, tronquée, ou correspondant à une autre version de Factur-X.',
    fix: "Reprenez l'URN exacte du profil visé, sans espace ni retour à la ligne parasite.",
  },
  'BR-CL-03': {
    title: 'Code devise invalide',
    meaning: 'La devise (BT-5) doit être un code ISO 4217 valide.',
    cause: 'Le symbole « € » ou la chaîne « Euro » a été transmis à la place du code.',
    fix: 'Utilisez le code à trois lettres : EUR.',
  },
  'BR-CL-10': {
    title: 'Code pays invalide',
    meaning: 'Les codes pays doivent suivre la norme ISO 3166-1 alpha-2.',
    cause:
      'Le nom du pays a été transmis en toutes lettres, ou un code à trois lettres a été utilisé.',
    fix: 'Utilisez le code à deux lettres : FR, BE, DE.',
  },
  'BR-CL-14': {
    title: 'Code pays invalide',
    meaning: "Le code pays de l'adresse doit suivre la norme ISO 3166-1 alpha-2.",
    cause: 'Le nom du pays a été transmis en toutes lettres.',
    fix: 'Utilisez le code à deux lettres : FR pour la France.',
  },
  'BR-CL-17': {
    title: 'Code catégorie de TVA invalide',
    meaning:
      'Le code catégorie de TVA (BT-118) doit appartenir à la liste UNTDID 5305 : S, Z, E, AE, K, G, O, L, M.',
    cause: 'Un code libre a été utilisé, par exemple « TVA20 » ou « NORMAL ».',
    fix: "Utilisez S pour le taux normal ou réduit, E pour une exonération, AE pour l'autoliquidation, K pour l'intracommunautaire, G pour l'export.",
  },
  'BR-CL-21': {
    title: 'Unité de mesure invalide',
    meaning: "L'unité de mesure (BT-130) doit appartenir à la liste UN/ECE Recommandation 20.",
    cause: 'Une unité en clair a été transmise, par exemple « heures » ou « pièces ».',
    fix: 'Utilisez les codes normalisés : C62 pour une unité ou pièce, HUR pour une heure, DAY pour un jour, KGM pour un kilogramme, MTR pour un mètre.',
  },
  'BR-CL-23': {
    title: 'Unité de mesure invalide',
    meaning: "L'unité de la quantité facturée doit appartenir à la liste UN/ECE Recommandation 20.",
    cause: 'Une unité en clair a été transmise.',
    fix: 'Utilisez C62 pour une pièce, HUR pour une heure, DAY pour un jour.',
  },
};

/* -------------------------------------------------------------------------- */
/* French national rules (BR-FR-*), from the DGFiP Flux 2 Schematron          */
/* -------------------------------------------------------------------------- */

const FRENCH: Record<string, CatalogueEntry> = {
  'BR-FR-05': {
    title: 'Mentions légales de paiement absentes',
    meaning:
      "La réglementation française impose de faire figurer dans les notes (BG-1) trois mentions : les pénalités de retard (code PMD), l'indemnité forfaitaire de recouvrement de 40 € (code PMT), et l'escompte ou son absence (code AAB).",
    cause:
      "Ces mentions sont imprimées en pied de page du PDF mais n'ont pas été reprises dans le XML, où elles doivent être structurées avec leur code de sujet.",
    fix: "Ajoutez trois notes structurées : une avec le code PMD pour les pénalités de retard, une avec le code PMT pour l'indemnité de 40 €, une avec le code AAB pour l'escompte. Ce sont des mentions obligatoires au titre de l'article L441-9 du Code de commerce.",
  },
  'BR-FR-08': {
    title: 'Numéro de TVA du vendeur requis',
    meaning:
      'Un vendeur assujetti à la TVA doit faire figurer son numéro de TVA intracommunautaire (BT-31).',
    cause: "Le numéro n'a pas été renseigné dans la fiche entreprise.",
    fix: 'Renseignez votre numéro au format FR + clé à 2 chiffres + SIREN. La clé se calcule ainsi : (12 + 3 × (SIREN modulo 97)) modulo 97.',
  },
  'BR-FR-12': {
    title: "Adresse électronique de l'acheteur absente",
    meaning:
      "La réforme française impose de renseigner l'adresse électronique de l'acheteur (BT-49), qui sert à router la facture via l'Annuaire.",
    cause:
      "Ce champ n'existe pas dans les logiciels de facturation antérieurs à la réforme : c'est une nouveauté du modèle en 5 coins.",
    fix: "Renseignez l'adresse électronique de votre client, généralement son SIRET tel qu'il est publié dans l'Annuaire. Sans cette information, votre plateforme ne saura pas à quelle plateforme destinataire adresser la facture.",
  },
  'BR-FR-13': {
    title: 'Adresse électronique du vendeur absente',
    meaning: "La réforme française impose de renseigner l'adresse électronique du vendeur (BT-34).",
    cause: 'Champ introduit par la réforme, non géré par les logiciels antérieurs.',
    fix: 'Renseignez votre propre adresse électronique de routage, généralement votre SIRET déclaré auprès de votre plateforme agréée.',
  },
};

/* -------------------------------------------------------------------------- */
/* PEPPOL interoperability                                                    */
/* -------------------------------------------------------------------------- */

const PEPPOL: Record<string, CatalogueEntry> = {
  'PEPPOL-EN16931-R001': {
    title: 'Processus métier non déclaré',
    meaning: "Les règles PEPPOL demandent de déclarer l'identifiant du processus métier (BT-23).",
    cause: 'Champ optionnel dans Factur-X mais attendu par le réseau PEPPOL.',
    fix: 'Renseignez BusinessProcessSpecifiedDocumentContextParameter, par exemple « urn:fdc:peppol.eu:2017:poacc:billing:01:1.0 ». Sans blocage immédiat en France, mais utile car PEPPOL est le transport par défaut entre plateformes agréées.',
  },
  'PEPPOL-EN16931-R008': {
    title: 'Le document contient des éléments vides',
    meaning: 'Un document ne doit pas comporter de balises XML vides.',
    cause:
      "Le générateur émet systématiquement toutes les balises du schéma, y compris celles qu'il n'a pas alimentées.",
    fix: "Supprimez les balises sans contenu plutôt que de les émettre vides. Un élément absent et un élément vide n'ont pas le même sens pour un validateur.",
  },
  'PEPPOL-EN16931-R010': {
    title: "Adresse électronique de l'acheteur non déclarée",
    meaning: "Les règles PEPPOL demandent l'adresse électronique de l'acheteur (BT-49).",
    cause: 'Champ non géré par le logiciel émetteur.',
    fix: "Renseignez l'identifiant électronique de l'acheteur avec son schéma (0009 pour un SIRET français).",
  },
  'PEPPOL-EN16931-R020': {
    title: 'Adresse électronique du vendeur non déclarée',
    meaning: "Les règles PEPPOL demandent l'adresse électronique du vendeur (BT-34).",
    cause: 'Champ non géré par le logiciel émetteur.',
    fix: 'Renseignez votre identifiant électronique avec son schéma (0009 pour un SIRET français).',
  },
};

/* -------------------------------------------------------------------------- */

const CATALOGUE: Record<string, CatalogueEntry> = {
  ...MANDATORY,
  ...ARITHMETIC,
  ...VAT_CATEGORIES,
  ...CODE_LISTS,
  ...FRENCH,
  ...PEPPOL,
};

/**
 * Family-level fallbacks for rules without an individual entry.
 *
 * Ordered most to least specific; the first matching pattern wins. This keeps an unrecognised rule
 * useful - the user still learns which body of rules complained and roughly what it governs -
 * rather than being shown a bare identifier.
 */
const FAMILY_FALLBACKS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly build: (ruleId: string) => CatalogueEntry;
}> = [
  {
    pattern: /^BR-DE-/,
    build: () => ({
      title: 'Règle allemande XRechnung - sans objet pour une facture française',
      meaning:
        "Cette règle appartient à XRechnung, la déclinaison nationale allemande de l'EN 16931. Le moteur de validation l'évalue systématiquement, quelle que soit l'origine de la facture.",
      cause:
        "Votre facture ne respecte pas une obligation allemande. Pour une facture franco-française, cela n'a aucune conséquence.",
      fix: 'Aucune action nécessaire si vous facturez en France. Ne tenez compte de ces règles que si votre client est établi en Allemagne et exige le format XRechnung.',
      appliesInFrance: false,
    }),
  },
  {
    pattern: /^BR-FR-/,
    build: (ruleId) => ({
      title: `Règle française ${ruleId} non respectée`,
      meaning:
        'Cette règle provient du Schematron « Flux 2 » de la DGFiP, qui porte les exigences propres à la réforme française.',
      cause: 'Une donnée exigée par la réglementation française est absente ou mal formée.',
      fix: 'Le message détaillé ci-dessous, rédigé par la DGFiP, indique le champ concerné. Ces règles étant spécifiquement françaises, elles sont à corriger en priorité.',
    }),
  },
  {
    pattern: /^BR-CL-/,
    build: () => ({
      title: 'Valeur hors liste de codes',
      meaning:
        'Le champ doit prendre sa valeur dans une liste de codes normalisée (ISO, UNTDID ou UN/ECE).',
      cause: 'Une valeur en texte libre a été transmise là où un code normalisé est attendu.',
      fix: 'Remplacez la valeur par le code officiel correspondant. Les listes les plus courantes sont ISO 4217 pour les devises, ISO 3166 pour les pays, UNTDID 5305 pour les catégories de TVA et UN/ECE Rec 20 pour les unités.',
    }),
  },
  {
    pattern: /^BR-CO-/,
    build: () => ({
      title: 'Incohérence de calcul entre plusieurs montants',
      meaning:
        'Les règles BR-CO vérifient la cohérence arithmétique de la facture : les totaux doivent découler exactement des lignes et de la ventilation de TVA.',
      cause:
        "Presque toujours un problème d'arrondi ou un total saisi manuellement qui n'a pas suivi une modification de la facture.",
      fix: "Recalculez les totaux à partir des lignes, en arrondissant chaque montant à deux décimales avant de l'additionner.",
    }),
  },
  {
    pattern: /^BR-(S|Z|E|AE|G|K|O|L|M|IC|IG|IP)-/,
    build: () => ({
      title: 'Incohérence de catégorie de TVA',
      meaning:
        'Les règles par catégorie vérifient que le régime de TVA annoncé sur les lignes est repris de façon cohérente dans la ventilation de synthèse.',
      cause:
        'Le taux ou la catégorie déclarés sur les lignes ne correspondent pas au bloc de ventilation de TVA.',
      fix: "Vérifiez qu'il existe exactement un bloc de ventilation par couple catégorie/taux utilisé dans les lignes, et que les bases correspondent.",
    }),
  },
  {
    pattern: /^BR-\d+$/,
    build: () => ({
      title: 'Donnée obligatoire absente',
      meaning: "L'EN 16931 impose la présence de ce champ dans toute facture conforme.",
      cause: 'Le champ est absent, vide, ou renseigné dans un format non reconnu.',
      fix: 'Renseignez le champ indiqué dans le message. Le terme métier (BT-xx) mentionné vous indique précisément lequel.',
    }),
  },
  {
    pattern: /^CII-(SR|DT)-/,
    build: () => ({
      title: 'Problème de structure du XML CII',
      meaning:
        'Les règles CII-SR vérifient la syntaxe CII elle-même : ordre des éléments, cardinalités, types de données.',
      cause:
        "Le XML a été généré à la main ou par un outil qui ne respecte pas strictement l'ordre imposé par le schéma.",
      fix: "Régénérez le XML avec une bibliothèque conforme. L'ordre des éléments dans CII est imposé et ne peut pas être modifié.",
    }),
  },
  {
    pattern: /^PEPPOL-/,
    build: () => ({
      title: "Règle d'interopérabilité PEPPOL",
      meaning:
        'Cette règle provient du réseau PEPPOL, transport par défaut des factures entre plateformes agréées.',
      cause:
        "Une donnée attendue par PEPPOL est absente, sans être bloquante au titre de l'EN 16931.",
      fix: 'Corrigez si vos échanges transitent par PEPPOL. Ces règles sont généralement des recommandations, pas des blocages.',
    }),
  },
];

/** Looks up the explanation for a rule, falling back to its family. */
export function explainRule(ruleId: string | null): RuleExplanation | null {
  if (!ruleId) return null;
  const id = ruleId.trim().toUpperCase();

  const exact = CATALOGUE[id];
  if (exact) {
    return { id, appliesInFrance: exact.appliesInFrance ?? true, ...exact };
  }

  for (const { pattern, build } of FAMILY_FALLBACKS) {
    if (pattern.test(id)) {
      const entry = build(id);
      return { id, appliesInFrance: entry.appliesInFrance ?? true, ...entry };
    }
  }
  return null;
}

/**
 * Whether a finding should be treated as applicable to a French domestic invoice.
 *
 * Ruleset provenance is checked before the catalogue: it comes from the engine itself and is
 * therefore reliable even for rules with no catalogue entry at all.
 */
export function appliesInFrance(ruleset: Ruleset, ruleId: string | null): boolean {
  if (ruleset === 'xrechnung-de') return false;
  const explanation = explainRule(ruleId);
  return explanation?.appliesInFrance ?? true;
}

/** French label for a severity, for display. */
export function severityLabel(severity: Severity): string {
  switch (severity) {
    case 'fatal':
    case 'exception':
      return 'Erreur bloquante';
    case 'error':
      return 'Erreur';
    case 'warning':
      return 'Avertissement';
    case 'notice':
      return 'Information';
  }
}

/** French label for a ruleset, for display. */
export function rulesetLabel(ruleset: Ruleset): string {
  switch (ruleset) {
    case 'facturx-en16931':
      return 'Factur-X / EN 16931';
    case 'cius-fr':
      return 'Règles françaises (DGFiP)';
    case 'xrechnung-de':
      return 'Règles allemandes (XRechnung)';
    case 'peppol':
      return 'Interopérabilité PEPPOL';
    case 'other':
      return 'Autre';
  }
}

/** Number of individually-written entries; used by tests to guard against accidental deletion. */
export const CATALOGUE_SIZE = Object.keys(CATALOGUE).length;
