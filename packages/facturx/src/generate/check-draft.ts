/**
 * Pre-flight checks on a draft, before anything is generated.
 *
 * The engine is the authority on whether a *document* conforms. This runs one step earlier, on the
 * data, and exists because the two produce very different experiences. A Schematron failure arrives
 * as `[BR-E-10]-An Invoice that contains a VAT breakdown group (BG-23) with a VAT category code
 * (BT-118) "Exempt from VAT" shall have a VAT exemption reason code (BT-121) or a VAT exemption
 * reason text (BT-120)` - after the fact, about a document the user did not know they were
 * building. The same problem caught here reads "la ligne 2 est exonérée de TVA mais n'indique pas
 * pourquoi", against the field they are editing.
 *
 * Every problem is reported, not just the first: a user fixing an invoice one error per round trip
 * gives up. Anything that only the engine can settle is left to the engine - this checks the
 * conditions we would otherwise knowingly emit a rejected document for.
 */

import {
  sirenFromSiret,
  validateFrenchVatNumber,
  validateSiren,
  validateSiret,
} from '../identifiers.js';
import { type Decimal, compare, format, isZero, parseDecimal, ZERO } from '../money.js';
import { computeInvoice, DraftAmountError } from './compute.js';
import {
  type DraftParty,
  type InvoiceDraft,
  type VatCategory,
  DRAFT_TYPE_CODES,
  REASON_REQUIRED_CATEGORIES,
  VAT_CATEGORIES,
  ZERO_RATED_CATEGORIES,
} from './draft.js';

export type DraftIssueSeverity = 'error' | 'warning';

export interface DraftIssue {
  /** Dotted path to the offending field, e.g. `lines.1.exemptionReason`. */
  readonly field: string;
  /** `error` blocks generation; `warning` does not. */
  readonly severity: DraftIssueSeverity;
  /** What is wrong, in French, in the user's terms. */
  readonly message: string;
  /** The EN 16931 or French rule this anticipates, when there is one. */
  readonly ruleId?: string;
}

export interface DraftCheckResult {
  readonly ok: boolean;
  readonly issues: readonly DraftIssue[];
}

/** Rates in force in France. An unlisted rate is suspicious but not impossible, so it warns. */
const FRENCH_VAT_RATES = ['20', '10', '5.5', '2.1', '0'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * IBAN check-digit verification (ISO 13616, mod-97-10).
 *
 * A mistyped IBAN produces an invoice that is perfectly valid and never gets paid - the failure
 * mode a compliance validator is blind to, and the one the business actually cares about.
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  // Letters become two digits (A=10 ... Z=35), then the whole thing mod 97 must be 1. Reduced in
  // chunks so no intermediate exceeds a safe integer.
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : (char.charCodeAt(0) - 55).toString();
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function checkParty(
  party: DraftParty,
  path: 'seller' | 'buyer',
  label: string,
  issues: DraftIssue[],
): void {
  if (!party.name?.trim()) {
    issues.push({
      field: `${path}.name`,
      severity: 'error',
      message: `Le nom ${label} est obligatoire.`,
      ruleId: path === 'seller' ? 'BR-06' : 'BR-07',
    });
  }

  const address = party.address;
  if (!address?.countryCode?.trim()) {
    issues.push({
      field: `${path}.address.countryCode`,
      severity: 'error',
      message: `Le pays ${label} est obligatoire.`,
      ruleId: path === 'seller' ? 'BR-09' : 'BR-11',
    });
  } else if (!/^[A-Z]{2}$/.test(address.countryCode.trim().toUpperCase())) {
    issues.push({
      field: `${path}.address.countryCode`,
      severity: 'error',
      message: `Le code pays ${label} doit être un code ISO à deux lettres, par exemple « FR ».`,
    });
  }

  for (const [key, value, name] of [
    ['line1', address?.line1, 'La voie'],
    ['postcode', address?.postcode, 'Le code postal'],
    ['city', address?.city, 'La ville'],
  ] as const) {
    if (!value?.trim()) {
      issues.push({
        field: `${path}.address.${key}`,
        severity: 'warning',
        message: `${name} de l'adresse ${label} n'est pas renseignée.`,
      });
    }
  }

  const isFrench = (address?.countryCode ?? '').trim().toUpperCase() === 'FR';

  if (party.siret) {
    const siret = validateSiret(party.siret);
    if (!siret.valid) {
      issues.push({
        field: `${path}.siret`,
        severity: 'error',
        message: `SIRET ${label} invalide : ${siret.reason ?? 'clé de contrôle incorrecte'}.`,
      });
    }
  } else if (party.siren) {
    const siren = validateSiren(party.siren);
    if (!siren.valid) {
      issues.push({
        field: `${path}.siren`,
        severity: 'error',
        message: `SIREN ${label} invalide : ${siren.reason ?? 'clé de contrôle incorrecte'}.`,
      });
    }
  } else if (isFrench) {
    // Routing under the 5-corner model is keyed on SIRET. Without one, the invoice can be built
    // but not delivered - a warning on the seller side, and on the buyer side the reason the
    // platform will not know where to send it.
    issues.push({
      field: `${path}.siret`,
      severity: path === 'seller' ? 'error' : 'warning',
      message:
        path === 'seller'
          ? "Le SIRET de l'émetteur est obligatoire sur une facture française."
          : "Le SIRET du client n'est pas renseigné : sans lui, la facture ne pourra pas être routée vers son destinataire par l'annuaire.",
      ruleId: path === 'seller' ? 'BR-FR-01' : undefined,
    });
  }

  if (party.vatId) {
    const upper = party.vatId.replace(/\s/g, '').toUpperCase();
    if (upper.startsWith('FR')) {
      const vat = validateFrenchVatNumber(upper);
      if (!vat.valid) {
        issues.push({
          field: `${path}.vatId`,
          severity: 'error',
          message: `Numéro de TVA ${label} invalide : ${vat.reason ?? 'format incorrect'}.`,
        });
      } else {
        // A VAT number that checksums correctly but belongs to a different company is worse than a
        // malformed one, because nothing downstream will question it.
        const siren = party.siren ?? sirenFromSiret(party.siret);
        if (siren && !upper.endsWith(siren)) {
          issues.push({
            field: `${path}.vatId`,
            severity: 'error',
            message: `Le numéro de TVA ${label} (${upper}) ne correspond pas au SIREN ${siren}.`,
          });
        }
      }
    } else if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(upper)) {
      issues.push({
        field: `${path}.vatId`,
        severity: 'error',
        message: `Numéro de TVA ${label} invalide : il doit commencer par un code pays à deux lettres.`,
      });
    }
  }
}

function checkLines(draft: InvoiceDraft, issues: DraftIssue[]): void {
  if (draft.lines.length === 0) {
    issues.push({
      field: 'lines',
      severity: 'error',
      message: 'Une facture doit comporter au moins une ligne.',
      ruleId: 'BR-16',
    });
    return;
  }

  // Two lines exempt at the same rate but for different stated reasons collapse into one VAT
  // breakdown group, and one of the reasons is silently dropped. Better to say so.
  const reasonsByGroup = new Map<string, Set<string>>();

  draft.lines.forEach((line, index) => {
    const at = `lines.${index}`;
    const human = `Ligne ${index + 1}`;

    if (!line.name?.trim()) {
      issues.push({
        field: `${at}.name`,
        severity: 'error',
        message: `${human} : la désignation est obligatoire.`,
        ruleId: 'BR-25',
      });
    }
    if (!line.unitCode?.trim()) {
      issues.push({
        field: `${at}.unitCode`,
        severity: 'error',
        message: `${human} : l'unité de mesure est obligatoire (par exemple « C62 » pour une unité, « HUR » pour une heure).`,
        ruleId: 'BR-23',
      });
    }

    const quantity = parseDecimal(line.quantity);
    if (quantity === null) {
      issues.push({
        field: `${at}.quantity`,
        severity: 'error',
        message: `${human} : la quantité « ${line.quantity} » n'est pas un nombre.`,
        ruleId: 'BR-22',
      });
    } else if (isZero(quantity)) {
      issues.push({
        field: `${at}.quantity`,
        severity: 'warning',
        message: `${human} : la quantité est nulle, la ligne ne comptera pour rien dans les totaux.`,
      });
    }

    if (parseDecimal(line.unitPrice) === null) {
      issues.push({
        field: `${at}.unitPrice`,
        severity: 'error',
        message: `${human} : le prix unitaire « ${line.unitPrice} » n'est pas un nombre.`,
        ruleId: 'BR-24',
      });
    }

    if (!VAT_CATEGORIES.includes(line.vatCategory)) {
      issues.push({
        field: `${at}.vatCategory`,
        severity: 'error',
        message: `${human} : catégorie de TVA « ${String(line.vatCategory)} » inconnue. Valeurs possibles : ${VAT_CATEGORIES.join(', ')}.`,
        ruleId: 'BR-CO-04',
      });
      return;
    }

    const rate = parseDecimal(line.vatRatePercent);
    if (rate === null) {
      issues.push({
        field: `${at}.vatRatePercent`,
        severity: 'error',
        message: `${human} : le taux de TVA « ${line.vatRatePercent} » n'est pas un nombre.`,
      });
      return;
    }

    checkVatCoherence(line.vatCategory, rate, line.exemptionReason, at, human, issues);

    if (REASON_REQUIRED_CATEGORIES.includes(line.vatCategory) && line.exemptionReason?.trim()) {
      const key = `${line.vatCategory}|${line.vatRatePercent}`;
      const reasons = reasonsByGroup.get(key) ?? new Set<string>();
      reasons.add(line.exemptionReason.trim());
      reasonsByGroup.set(key, reasons);
    }
  });

  // BR-IC-12: an intra-community supply is exempt because the goods leave for another member
  // state, so the document has to say where they went. Without BT-80 the invoice is rejected.
  if (draft.lines.some((line) => line.vatCategory === 'K') && !draft.deliveryCountryCode?.trim()) {
    issues.push({
      field: 'deliveryCountryCode',
      severity: 'error',
      message:
        "La facture comporte une livraison intracommunautaire (catégorie « K ») : le pays de livraison est obligatoire, c'est lui qui justifie l'exonération.",
      ruleId: 'BR-IC-12',
    });
  }

  for (const [key, reasons] of reasonsByGroup) {
    if (reasons.size > 1) {
      const [category] = key.split('|');
      issues.push({
        field: 'lines',
        severity: 'warning',
        message: `Plusieurs motifs d'exonération différents sont indiqués pour la catégorie de TVA « ${category} ». La ventilation de TVA n'en portera qu'un seul : « ${[...reasons][0]} ».`,
        ruleId: 'BR-CO-18',
      });
    }
  }
}

function checkVatCoherence(
  category: VatCategory,
  rate: Decimal,
  exemptionReason: string | null | undefined,
  at: string,
  human: string,
  issues: DraftIssue[],
): void {
  const zeroRated = ZERO_RATED_CATEGORIES.includes(category);

  if (zeroRated && !isZero(rate)) {
    issues.push({
      field: `${at}.vatRatePercent`,
      severity: 'error',
      message: `${human} : la catégorie « ${category} » n'applique pas de TVA, le taux doit donc être 0.`,
      ruleId: `BR-${rulePrefix(category)}-05`,
    });
  }

  if (REASON_REQUIRED_CATEGORIES.includes(category) && !exemptionReason?.trim()) {
    issues.push({
      field: `${at}.exemptionReason`,
      severity: 'error',
      message: `${human} : la TVA n'est pas facturée (catégorie « ${category} »), il faut donc indiquer pourquoi — par exemple « Autoliquidation » ou « Exonération article 262 ter I du CGI ».`,
      ruleId: `BR-${rulePrefix(category)}-10`,
    });
  }

  // Zero-rated is the one category where a reason is forbidden rather than required; see the note
  // on REASON_REQUIRED_CATEGORIES. Reported as a warning because the generator drops the reason
  // rather than emitting an invalid document - the user only needs to know it will not appear.
  if (category === 'Z' && exemptionReason?.trim()) {
    issues.push({
      field: `${at}.exemptionReason`,
      severity: 'warning',
      message: `${human} : un motif d'exonération ne peut pas figurer sur une ligne au taux zéro (catégorie « Z ») — la norme l'interdit. Il ne sera pas repris sur la facture. Pour une opération réellement exonérée, utilisez la catégorie « E ».`,
      ruleId: 'BR-Z-10',
    });
  }

  if (category === 'S') {
    if (compare(rate, ZERO) <= 0) {
      issues.push({
        field: `${at}.vatRatePercent`,
        severity: 'error',
        message: `${human} : la catégorie « S » est le taux normal, le taux de TVA doit être supérieur à 0. Pour une facture sans TVA, utilisez une autre catégorie.`,
        ruleId: 'BR-S-05',
      });
    } else if (!FRENCH_VAT_RATES.includes(stripTrailingZeros(rate))) {
      issues.push({
        field: `${at}.vatRatePercent`,
        severity: 'warning',
        message: `${human} : le taux de ${stripTrailingZeros(rate)} % ne correspond à aucun taux de TVA français (20, 10, 5,5 ou 2,1 %).`,
      });
    }
  }
}

/**
 * The rule-family prefix for a VAT category.
 *
 * Mostly the code itself, but intra-community supply is category `K` while its rules are named
 * `BR-IC-*`. Quoting `BR-K-10` at a user would send them looking for a rule that does not exist.
 */
function rulePrefix(category: VatCategory): string {
  return category === 'K' ? 'IC' : category;
}

/** `20.00` and `20` are the same rate; comparison against the known rates needs one spelling. */
function stripTrailingZeros(rate: Decimal): string {
  const plain = format(rate);
  return plain.includes('.') ? plain.replace(/0+$/, '').replace(/\.$/, '') : plain;
}

function checkHeader(draft: InvoiceDraft, issues: DraftIssue[]): void {
  if (!draft.invoiceNumber?.trim()) {
    issues.push({
      field: 'invoiceNumber',
      severity: 'error',
      message: 'Le numéro de facture est obligatoire.',
      ruleId: 'BR-02',
    });
  }

  if (!draft.issueDate?.trim()) {
    issues.push({
      field: 'issueDate',
      severity: 'error',
      message: "La date d'émission est obligatoire.",
      ruleId: 'BR-03',
    });
  } else if (!isRealDate(draft.issueDate)) {
    issues.push({
      field: 'issueDate',
      severity: 'error',
      message: `La date d'émission « ${draft.issueDate} » n'est pas une date valide au format AAAA-MM-JJ.`,
    });
  }

  if (draft.dueDate) {
    if (!isRealDate(draft.dueDate)) {
      issues.push({
        field: 'dueDate',
        severity: 'error',
        message: `La date d'échéance « ${draft.dueDate} » n'est pas une date valide au format AAAA-MM-JJ.`,
      });
    } else if (isRealDate(draft.issueDate ?? '') && draft.dueDate < draft.issueDate) {
      issues.push({
        field: 'dueDate',
        severity: 'error',
        message: "La date d'échéance est antérieure à la date d'émission.",
      });
    }
  }

  if (draft.deliveryDate && !isRealDate(draft.deliveryDate)) {
    issues.push({
      field: 'deliveryDate',
      severity: 'error',
      message: `La date de livraison « ${draft.deliveryDate} » n'est pas une date valide au format AAAA-MM-JJ.`,
    });
  }

  if (draft.typeCode && !DRAFT_TYPE_CODES.includes(draft.typeCode)) {
    issues.push({
      field: 'typeCode',
      severity: 'error',
      message: `Type de document « ${String(draft.typeCode)} » non pris en charge. Valeurs possibles : ${DRAFT_TYPE_CODES.join(', ')}.`,
      ruleId: 'BR-CO-03',
    });
  }

  const currency = draft.currency ?? 'EUR';
  if (!/^[A-Z]{3}$/.test(currency)) {
    issues.push({
      field: 'currency',
      severity: 'error',
      message: `La devise « ${currency} » doit être un code ISO 4217 à trois lettres, par exemple « EUR ».`,
      ruleId: 'BR-05',
    });
  }

  if (draft.iban && !isValidIban(draft.iban)) {
    issues.push({
      field: 'iban',
      severity: 'error',
      message: `L'IBAN « ${draft.iban} » est incorrect : sa clé de contrôle ne correspond pas. Une facture avec un IBAN erroné est valide au sens de la norme mais ne sera pas payée.`,
    });
  }
}

/**
 * Checks a draft, reporting every problem found.
 *
 * `ok` is false only when at least one `error` is present; warnings describe a document that will
 * be generated and will validate, but that its sender probably did not intend.
 */
export function checkDraft(draft: InvoiceDraft): DraftCheckResult {
  const issues: DraftIssue[] = [];

  checkHeader(draft, issues);
  checkParty(draft.seller, 'seller', "de l'émetteur", issues);
  checkParty(draft.buyer, 'buyer', 'du client', issues);
  checkLines(draft, issues);

  // BR-CO-25: something has to tell the buyer when to pay. Only computable once the amounts are
  // known, and only worth computing if the amounts are readable at all.
  if (!issues.some((issue) => issue.severity === 'error')) {
    try {
      const { totals } = computeInvoice(draft);
      if (compare(totals.duePayableAmount, ZERO) > 0 && !draft.dueDate && !draft.paymentTerms) {
        issues.push({
          field: 'dueDate',
          severity: 'error',
          message:
            "Un montant restant dû est facturé : la facture doit porter une date d'échéance ou des conditions de paiement.",
          ruleId: 'BR-CO-25',
        });
      }
      if (compare(totals.prepaidAmount, totals.grandTotalAmount) > 0) {
        issues.push({
          field: 'prepaidAmount',
          severity: 'error',
          message: "L'acompte déjà versé dépasse le total TTC de la facture.",
        });
      }
    } catch (error) {
      if (!(error instanceof DraftAmountError)) throw error;
      issues.push({ field: 'lines', severity: 'error', message: error.message });
    }
  }

  return { ok: !issues.some((issue) => issue.severity === 'error'), issues };
}
