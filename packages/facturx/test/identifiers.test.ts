import { describe, expect, it } from 'vitest';
import {
  formatSiren,
  formatSiret,
  sirenFromSiret,
  validateFrenchVatNumber,
  validateSiren,
  validateSiret,
  vatNumberFromSiren,
} from '../src/identifiers.js';

describe('validateSiren', () => {
  it('accepts real SIRENs', () => {
    // Danone and Renault - both public, both Luhn-valid.
    expect(validateSiren('552081317').valid).toBe(true);
    expect(validateSiren('441639465').valid).toBe(true);
  });

  it('accepts formatted input', () => {
    const result = validateSiren('552 081 317');
    expect(result.valid).toBe(true);
    expect(result.normalised).toBe('552081317');
  });

  it('rejects a bad checksum with a French explanation', () => {
    const result = validateSiren('552081318');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/clé de contrôle/i);
  });

  it('reports wrong length distinctly from wrong checksum', () => {
    expect(validateSiren('5520813').reason).toMatch(/9 chiffres/);
    expect(validateSiren('abcdefghi').reason).toMatch(/chiffres/);
  });

  it('accepts La Poste, the documented Luhn exception', () => {
    expect(validateSiren('356000000').valid).toBe(true);
  });

  it('rejects empty input as required rather than malformed', () => {
    expect(validateSiren('').reason).toMatch(/obligatoire/);
    expect(validateSiren(null).valid).toBe(false);
  });
});

describe('validateSiret', () => {
  it('accepts a Luhn-valid SIRET', () => {
    expect(validateSiret('55208131766522').valid).toBe(true);
  });

  it('rejects a bad checksum', () => {
    expect(validateSiret('55208131766523').valid).toBe(false);
  });

  it('enforces 14 digits', () => {
    expect(validateSiret('552081317').reason).toMatch(/14 chiffres/);
  });

  it('applies the La Poste digit-sum rule instead of Luhn', () => {
    // La Poste SIRETs fail Luhn by design; INSEE specifies a digit sum divisible by 5 instead.
    const laPoste = '35600000000015';
    const digitSum = [...laPoste].reduce((total, digit) => total + Number(digit), 0);
    expect(digitSum % 5).toBe(0);
    expect(validateSiret(laPoste).valid).toBe(true);
  });

  it('still rejects a La Poste SIRET whose digit sum is wrong', () => {
    // 3+5+6+4+8 = 26, not a multiple of 5 - the exception must not become a blanket pass.
    expect(validateSiret('35600000000048').valid).toBe(false);
  });

  it('extracts the owning SIREN', () => {
    expect(sirenFromSiret('55208131766522')).toBe('552081317');
    expect(sirenFromSiret('invalid')).toBeNull();
  });
});

describe('French VAT numbers', () => {
  it('computes the key from the SIREN', () => {
    // Key = (12 + 3 * (SIREN mod 97)) mod 97
    const vat = vatNumberFromSiren('552081317');
    expect(vat).toMatch(/^FR\d{2}552081317$/);
    expect(validateFrenchVatNumber(vat!).valid).toBe(true);
  });

  it('rejects a wrong key and names the expected number', () => {
    const correct = vatNumberFromSiren('552081317')!;
    const wrongKey = correct.slice(0, 2) === 'FR' ? `FR00${correct.slice(4)}` : correct;
    const result = validateFrenchVatNumber(wrongKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(correct);
  });

  it('requires the FR prefix and the right length', () => {
    expect(validateFrenchVatNumber('DE123456789').reason).toMatch(/FR/);
    expect(validateFrenchVatNumber('FR1255208131').reason).toMatch(/13 caractères/);
  });

  it('accepts an alphanumeric key without claiming to have verified it', () => {
    // Historic registrations exist whose key cannot be recomputed; rejecting them would block
    // legitimate businesses.
    expect(validateFrenchVatNumber('FRAB552081317').valid).toBe(true);
  });

  it('rejects a well-formed number whose embedded SIREN is invalid', () => {
    expect(validateFrenchVatNumber('FR12552081318').valid).toBe(false);
  });
});

describe('display formatting', () => {
  it('groups identifiers the way French documents print them', () => {
    expect(formatSiren('552081317')).toBe('552 081 317');
    expect(formatSiret('55208131766522')).toBe('552 081 317 66522');
  });

  it('returns malformed input untouched rather than mangling it', () => {
    expect(formatSiren('123')).toBe('123');
  });
});
