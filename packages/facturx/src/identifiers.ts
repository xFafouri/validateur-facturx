/**
 * French business identifier validation: SIREN, SIRET and intra-community VAT numbers.
 *
 * Under the 5-corner model, routing is driven by the Annuaire, which is keyed on SIREN/SIRET. A
 * malformed identifier does not produce a polite validation warning downstream - it produces an
 * invoice that cannot be routed to its recipient at all. Catching it at data-entry time is the
 * cheapest possible place to catch it, which is why this runs on party entry rather than only at
 * issue time.
 *
 * Checksum validation proves an identifier is *well-formed*, not that it *exists*. Confirming
 * existence requires a lookup against the Annuaire or the INSEE Sirene API; that is a separate
 * concern and belongs behind a network-backed service.
 */

export type IdentifierKind = 'SIREN' | 'SIRET';

export interface IdentifierValidation {
  readonly valid: boolean;
  /** Digits only, with all formatting stripped. Present even when invalid, for echoing back. */
  readonly normalised: string;
  /** French-language reason, suitable for showing directly next to the input. */
  readonly reason?: string;
}

/**
 * La Poste is the documented exception to the Luhn rule.
 *
 * Its establishments' SIRETs fail the standard checksum; INSEE specifies that they are valid when
 * the sum of their digits is a multiple of 5 instead. Without this branch, every La Poste
 * establishment would be rejected as malformed.
 */
const LA_POSTE_SIREN = '356000000';

function stripFormatting(raw: string): string {
  return raw.replace(/[\s.\-/]/g, '');
}

/**
 * Standard Luhn checksum as INSEE applies it: doubling every second digit counting from the right.
 */
function passesLuhn(digits: string): boolean {
  let total = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    total += value;
    double = !double;
  }
  return total % 10 === 0;
}

function digitSum(digits: string): number {
  let total = 0;
  for (let i = 0; i < digits.length; i += 1) total += digits.charCodeAt(i) - 48;
  return total;
}

/** A SIREN identifies a legal entity: 9 digits, Luhn-checked. */
export function validateSiren(raw: string | null | undefined): IdentifierValidation {
  if (raw == null || raw.trim() === '') {
    return { valid: false, normalised: '', reason: 'Le SIREN est obligatoire.' };
  }
  const normalised = stripFormatting(raw);

  if (!/^\d+$/.test(normalised)) {
    return {
      valid: false,
      normalised,
      reason: 'Le SIREN ne doit contenir que des chiffres.',
    };
  }
  if (normalised.length !== 9) {
    return {
      valid: false,
      normalised,
      reason: `Le SIREN doit comporter exactement 9 chiffres (${normalised.length} fourni${normalised.length > 1 ? 's' : ''}).`,
    };
  }
  if (normalised === LA_POSTE_SIREN) {
    return { valid: true, normalised };
  }
  if (!passesLuhn(normalised)) {
    return {
      valid: false,
      normalised,
      reason: 'La clé de contrôle du SIREN est incorrecte : vérifiez la saisie.',
    };
  }
  return { valid: true, normalised };
}

/** A SIRET identifies an establishment: its 9-digit SIREN plus a 5-digit NIC, Luhn-checked as a whole. */
export function validateSiret(raw: string | null | undefined): IdentifierValidation {
  if (raw == null || raw.trim() === '') {
    return { valid: false, normalised: '', reason: 'Le SIRET est obligatoire.' };
  }
  const normalised = stripFormatting(raw);

  if (!/^\d+$/.test(normalised)) {
    return {
      valid: false,
      normalised,
      reason: 'Le SIRET ne doit contenir que des chiffres.',
    };
  }
  if (normalised.length !== 14) {
    return {
      valid: false,
      normalised,
      reason: `Le SIRET doit comporter exactement 14 chiffres (${normalised.length} fourni${normalised.length > 1 ? 's' : ''}).`,
    };
  }

  if (normalised.startsWith(LA_POSTE_SIREN)) {
    return digitSum(normalised) % 5 === 0
      ? { valid: true, normalised }
      : {
          valid: false,
          normalised,
          reason: 'La clé de contrôle de ce SIRET La Poste est incorrecte.',
        };
  }

  if (!passesLuhn(normalised)) {
    return {
      valid: false,
      normalised,
      reason: 'La clé de contrôle du SIRET est incorrecte : vérifiez la saisie.',
    };
  }
  return { valid: true, normalised };
}

/** Extracts the owning SIREN from a SIRET, or `null` if the SIRET is not well-formed. */
export function sirenFromSiret(raw: string | null | undefined): string | null {
  const result = validateSiret(raw);
  return result.valid ? result.normalised.slice(0, 9) : null;
}

/**
 * Computes the French intra-community VAT number for a SIREN.
 *
 * Format is `FR` + a two-character key + the SIREN, where the key is `(12 + 3 * (SIREN mod 97)) mod 97`.
 */
export function vatNumberFromSiren(raw: string | null | undefined): string | null {
  const result = validateSiren(raw);
  if (!result.valid) return null;
  const key = (12 + 3 * (Number(result.normalised) % 97)) % 97;
  return `FR${key.toString().padStart(2, '0')}${result.normalised}`;
}

/**
 * Validates a French VAT number.
 *
 * The key may be alphanumeric for some historic registrations, so a non-numeric key is accepted as
 * well-formed but cannot be checksum-verified - reported as valid with a caveat rather than
 * rejected, since rejecting it would block legitimate businesses.
 */
export function validateFrenchVatNumber(raw: string | null | undefined): IdentifierValidation {
  if (raw == null || raw.trim() === '') {
    return { valid: false, normalised: '', reason: 'Le numéro de TVA est obligatoire.' };
  }
  const normalised = stripFormatting(raw).toUpperCase();

  if (!normalised.startsWith('FR')) {
    return {
      valid: false,
      normalised,
      reason: 'Un numéro de TVA français doit commencer par « FR ».',
    };
  }
  if (normalised.length !== 13) {
    return {
      valid: false,
      normalised,
      reason:
        'Un numéro de TVA français comporte 13 caractères : FR, une clé à 2 caractères, puis le SIREN à 9 chiffres.',
    };
  }

  const key = normalised.slice(2, 4);
  const siren = normalised.slice(4);

  const sirenResult = validateSiren(siren);
  if (!sirenResult.valid) {
    return {
      valid: false,
      normalised,
      reason:
        `Le SIREN contenu dans le numéro de TVA est invalide : ${sirenResult.reason ?? ''}`.trim(),
    };
  }

  if (!/^\d{2}$/.test(key)) {
    // Alphanumeric keys exist and cannot be recomputed; accept without checksum proof.
    return { valid: true, normalised };
  }

  const expected = vatNumberFromSiren(siren);
  if (expected !== normalised) {
    return {
      valid: false,
      normalised,
      reason: `La clé du numéro de TVA est incorrecte : pour ce SIREN, le numéro attendu est ${expected}.`,
    };
  }
  return { valid: true, normalised };
}

/** Groups a SIREN for display: `123 456 789`. */
export function formatSiren(raw: string): string {
  const digits = stripFormatting(raw);
  if (digits.length !== 9) return raw;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

/** Groups a SIRET for display: `123 456 789 00012`. */
export function formatSiret(raw: string): string {
  const digits = stripFormatting(raw);
  if (digits.length !== 14) return raw;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
}
