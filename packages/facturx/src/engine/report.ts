/**
 * Parses Mustangproject's native XML validation report into the engine-neutral model.
 *
 * The report's shape, confirmed empirically against validator v2.24.0:
 *
 * ```xml
 * <validation filename="…" datetime="…">
 *   <xml>
 *     <info><version/><profile/><rules><fired/><failed/></rules></info>
 *     <messages><error type="5" location="…" criterion="…">text</error>…</messages>
 *     <summary status="valid|invalid"/>
 *   </xml>
 *   <pdf>…</pdf>
 *   <messages/>
 *   <summary status="valid|invalid"/>
 * </validation>
 * ```
 *
 * Note that `<messages>` is nested *inside* `<xml>` (and `<pdf>`), not only at the top level, and
 * both levels carry a `<summary>`. The tree is therefore walked in full rather than read at fixed
 * paths.
 *
 * ## Why ruleset classification matters
 *
 * Mustang validates against several Schematron rulesets at once and reports them together. For a
 * French invoice that includes the German XRechnung ruleset, whose messages are written in German.
 * Presenting "Eine Rechnung muss Angaben zu PAYMENT INSTRUCTIONS enthalten" to a French user
 * validating a French invoice is worse than useless - it is a correct-looking complaint about a
 * regulation that does not apply to them.
 *
 * Every message carries a `from /xslt/<path>` suffix naming the ruleset that produced it, so
 * findings are classified by that path and the UI can rank French and EN 16931 rules first and
 * fold German ones away.
 */

import { XMLParser } from 'fast-xml-parser';
import { profileFromUrn, type FacturxProfile } from '../profiles.js';
import {
  type FindingPart,
  type Ruleset,
  type Severity,
  type ValidationFinding,
  type ValidationReport,
  type ValidationSummary,
  ValidationEngineError,
} from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

/** Element names that carry a finding, mapped to the severity they imply. */
const SEVERITY_BY_ELEMENT: Record<string, Severity> = {
  notice: 'notice',
  warning: 'warning',
  error: 'error',
  fatal: 'fatal',
  exception: 'exception',
};

/** Trailing provenance marker, e.g. ` from /xslt/ZF_250/FACTUR-X_BASIC.xslt)`. */
const SOURCE_SUFFIX = /\s*from\s+(\/xslt\/[^\s)]+)\)?\s*$/i;

/** Canonical rule identifier marker, e.g. ` [ID BR-FR-05_BT-22_PMT]`. */
const ID_MARKER = /\s*\[ID\s+([A-Za-z0-9_.-]+)\]\s*/;

/**
 * Maps an XSLT source path to the ruleset it represents.
 *
 * `XP_Z12_012` is the DGFiP "Flux 2" French Schematron - the rules specific to the French reform.
 * `ZF_250` is the Factur-X/ZUGFeRD distribution carrying the EN 16931 core rules. `XR_30` is
 * XRechnung 3.0, Germany's national CIUS.
 */
function classifyRuleset(sourcePath: string | null, ruleId: string | null): Ruleset {
  if (sourcePath) {
    if (/XP_Z12|BR-FR-Flux/i.test(sourcePath)) return 'cius-fr';
    if (/XR_\d|XRechnung/i.test(sourcePath)) return 'xrechnung-de';
    if (/ZF_\d|FACTUR-X/i.test(sourcePath)) return 'facturx-en16931';
  }
  // Fall back to the identifier's own prefix when provenance is absent.
  if (ruleId) {
    if (ruleId.startsWith('BR-FR')) return 'cius-fr';
    if (ruleId.startsWith('BR-DE')) return 'xrechnung-de';
    if (ruleId.startsWith('PEPPOL')) return 'peppol';
    if (ruleId.startsWith('BR-') || ruleId.startsWith('CII-')) return 'facturx-en16931';
  }
  return 'other';
}

/**
 * Recovers the rule identifier.
 *
 * Four distinct shapes occur in practice, so they are tried in order of reliability:
 *
 * 1. `[ID BR-FR-05_BT-22_PMT]` - canonical, appended by the Schematron harness.
 * 2. `[BR-CO-10]-Sum of Invoice line net amount…` - bracketed prefix, EN 16931 style.
 * 3. `BR-FR-12/BT-49 : Le BT-49 est obligatoire.` - French style, slash-qualified.
 * 4. Bare mention anywhere in the text.
 *
 * Returns both the base rule (`BR-FR-05`, used for explanation lookup) and the full variant
 * identifier (`BR-FR-05_BT-22_PMT`) when they differ, since one French rule can fail several ways
 * and the variant is what makes the message actionable.
 */
export function extractRuleId(
  message: string,
  criterion: string | null,
): { ruleId: string | null; variant: string | null } {
  const idMarker = ID_MARKER.exec(message);
  if (idMarker?.[1]) {
    const full = idMarker[1].toUpperCase();
    // `BR-FR-05_BT-22_PMT` -> base `BR-FR-05`; underscores separate the qualifiers.
    const base = full.split('_')[0] ?? full;
    return { ruleId: base, variant: full === base ? null : full };
  }

  const bracketed = /\[((?:BR|CII|PEPPOL|FR|UBL)[A-Z0-9-]*)\]/i.exec(message);
  if (bracketed?.[1]) {
    return { ruleId: bracketed[1].toUpperCase(), variant: null };
  }

  const frenchStyle = /^\s*((?:BR|CII)-[A-Z]{2,}-\d+)\s*\//i.exec(message);
  if (frenchStyle?.[1]) {
    return { ruleId: frenchStyle[1].toUpperCase(), variant: null };
  }

  const bare = /\b((?:BR-[A-Z]{1,3}-\d+|BR-\d+|CII-[A-Z]{2}-\d+|PEPPOL-EN16931-R\d+))\b/i.exec(
    message,
  );
  if (bare?.[1]) {
    return { ruleId: bare[1].toUpperCase(), variant: null };
  }

  if (criterion) {
    const inCriterion = /\b(BR-[A-Z]{0,3}-?\d+|CII-[A-Z]{2}-\d+)\b/i.exec(criterion);
    if (inCriterion?.[1]) return { ruleId: inCriterion[1].toUpperCase(), variant: null };
  }

  return { ruleId: null, variant: null };
}

/**
 * Strips engine plumbing from a message so it reads as a sentence.
 *
 * Removes the `from /xslt/…` provenance and the `[ID …]` marker - both are captured as structured
 * fields - and the stray trailing parenthesis Mustang emits.
 */
function cleanMessage(raw: string): string {
  let message = raw.replace(SOURCE_SUFFIX, '');
  message = message.replace(ID_MARKER, ' ');
  message = message.replace(/\s*\(still status warning\)\s*/i, ' ');
  message = message.replace(/\s+/g, ' ').trim();
  // Bracketed rule prefixes are shown as a separate badge in the UI.
  message = message.replace(/^\[[A-Z0-9-]+\]\s*-?\s*/i, '');
  return message.replace(/\s*\)$/, '').trim();
}

type XmlNode = Record<string, unknown>;

function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ');
  if (typeof node === 'object') {
    const value = (node as XmlNode)['#text'];
    return value === undefined ? '' : textOf(value);
  }
  return '';
}

function attrOf(node: unknown, name: string): string | null {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null;
  const value = (node as XmlNode)[`@_${name}`];
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function toFinding(node: unknown, severity: Severity, part: FindingPart): ValidationFinding {
  const rawMessage = textOf(node);
  const criterion = attrOf(node, 'criterion');
  const sectionRaw = attrOf(node, 'type');
  const section = sectionRaw !== null && /^\d+$/.test(sectionRaw) ? Number(sectionRaw) : null;

  const sourcePath = SOURCE_SUFFIX.exec(rawMessage)?.[1] ?? null;
  const { ruleId, variant } = extractRuleId(rawMessage, criterion);

  return {
    severity,
    part,
    ruleId,
    ruleVariant: variant,
    ruleset: classifyRuleset(sourcePath, ruleId),
    message: cleanMessage(rawMessage),
    rawMessage,
    location: attrOf(node, 'location'),
    criterion: criterion === 'false' ? null : criterion,
    sourcePath,
    section,
  };
}

/**
 * Recursively collects findings, tracking which document part each was nested under.
 *
 * `<pdf>` and `<xml>` set the part for everything beneath them; anything outside both is `general`.
 */
function collectFindings(node: unknown, part: FindingPart, out: ValidationFinding[]): void {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;

  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith('@_') || key === '#text') continue;

    const severity = SEVERITY_BY_ELEMENT[key];
    if (severity) {
      for (const entry of Array.isArray(value) ? value : [value]) {
        const finding = toFinding(entry, severity, part);
        if (finding.message !== '') out.push(finding);
      }
      continue;
    }

    const nextPart: FindingPart = key === 'pdf' ? 'pdf' : key === 'xml' ? 'xml' : part;
    for (const entry of Array.isArray(value) ? value : [value]) {
      collectFindings(entry, nextPart, out);
    }
  }
}

function statusOf(node: unknown): string | null {
  if (node === null || typeof node !== 'object') return null;
  const summary = (node as XmlNode).summary;
  if (summary === undefined) return null;
  return attrOf(Array.isArray(summary) ? summary[0] : summary, 'status');
}

/** Locates an element's text by name anywhere in the tree; depth-capped against cyclic input. */
function findElementText(node: unknown, name: string, depth = 0): string | null {
  if (node === null || typeof node !== 'object' || depth > 12) return null;

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findElementText(entry, name, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith('@_') || key === '#text') continue;
    if (key === name) {
      const text = textOf(Array.isArray(value) ? value[0] : value);
      if (text) return text;
    }
    const found = findElementText(value, name, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Maps a reported profile string - a full guideline URN or a short name - to our enum. */
function resolveProfile(raw: string | null): FacturxProfile | null {
  if (!raw) return null;

  const fromUrn = profileFromUrn(raw);
  if (fromUrn) return fromUrn;

  const normalised = raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, '');
  switch (normalised) {
    case 'MINIMUM':
      return 'MINIMUM';
    case 'BASICWL':
      return 'BASIC_WL';
    case 'BASIC':
      return 'BASIC';
    case 'EN16931':
    case 'COMFORT':
      return 'EN_16931';
    case 'EXTENDED':
      return 'EXTENDED';
    default:
      return null;
  }
}

function countRules(validation: unknown, element: string): number | null {
  const raw = findElementText(validation, element);
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Parses a Mustang report. `durationMs` comes from the transport, not the report body. */
export function parseMustangReport(rawReport: string, durationMs: number | null): ValidationReport {
  let parsed: unknown;
  try {
    parsed = parser.parse(rawReport);
  } catch (error) {
    throw new ValidationEngineError(
      "Le rapport de validation n'a pas pu être analysé.",
      'engine_failure',
      error,
    );
  }

  const validation = (parsed as XmlNode | undefined)?.validation;
  if (!validation) {
    throw new ValidationEngineError(
      "Le rapport de validation est incomplet : l'élément « validation » est absent.",
      'engine_failure',
    );
  }

  const findings: ValidationFinding[] = [];
  collectFindings(validation, 'general', findings);

  const overallStatus = statusOf(validation);
  const pdfNode = (validation as XmlNode).pdf;
  const xmlNode = (validation as XmlNode).xml;

  const pdfStatus =
    pdfNode === undefined ? null : statusOf(Array.isArray(pdfNode) ? pdfNode[0] : pdfNode);
  const xmlStatus =
    xmlNode === undefined ? null : statusOf(Array.isArray(xmlNode) ? xmlNode[0] : xmlNode);

  const summary: ValidationSummary = {
    valid: overallStatus === 'valid',
    pdf: pdfNode === undefined ? 'absent' : pdfStatus === 'valid' ? 'valid' : 'invalid',
    xml: xmlStatus === 'valid' ? 'valid' : overallStatus === 'valid' ? 'valid' : 'invalid',
  };

  const profileRaw = findElementText(validation, 'profile');

  return {
    summary,
    findings,
    profile: resolveProfile(profileRaw),
    detected: {
      profileRaw,
      version: findElementText(validation, 'version'),
    },
    rulesFired: countRules(validation, 'fired'),
    rulesFailed: countRules(validation, 'failed'),
    durationMs,
    rawReport,
  };
}
