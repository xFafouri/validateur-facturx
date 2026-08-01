/**
 * Locating a font that can legally be embedded in a PDF/A file.
 *
 * PDF/A forbids the standard 14 fonts, so there is no built-in to fall back on: an embeddable font
 * file has to come from somewhere. Rather than commit a megabyte of binary to the repository, the
 * generator takes the font bytes as a parameter and this module covers the common case of picking
 * one up from the host.
 *
 * Any deployment that generates invoices must therefore ship a font. `fonts-dejavu-core` in the
 * container image is the intended answer, and the error below says so, because a missing font
 * surfaces at the moment a user tries to issue their first invoice - the worst possible time to be
 * debugging a base image.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { EmbeddedFonts } from './pdf.js';

/**
 * Candidate paths, most preferred first.
 *
 * DejaVu leads because it covers French diacritics comfortably and is freely licensed; Liberation
 * and Noto are the usual alternatives on a minimal image.
 */
const REGULAR_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

const BOLD_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
];

export class FontNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontNotFoundError';
  }
}

function firstExisting(paths: readonly string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

/**
 * Finds an embeddable font pair on the host.
 *
 * `FACTURX_FONT_REGULAR` and `FACTURX_FONT_BOLD` override the search, which is what a deployment
 * with its own brand font uses.
 */
export function resolveSystemFonts(): EmbeddedFonts {
  const regularPath = process.env.FACTURX_FONT_REGULAR ?? firstExisting(REGULAR_CANDIDATES);
  const boldPath = process.env.FACTURX_FONT_BOLD ?? firstExisting(BOLD_CANDIDATES);

  if (!regularPath || !boldPath) {
    throw new FontNotFoundError(
      'Aucune police intégrable trouvée sur le système. PDF/A interdit les 14 polices standard du ' +
        'format PDF, un fichier de police est donc obligatoire pour produire une facture. Installez ' +
        'DejaVu (paquet « fonts-dejavu-core ») ou indiquez un fichier via FACTURX_FONT_REGULAR et ' +
        `FACTURX_FONT_BOLD. Chemins essayés : ${[...REGULAR_CANDIDATES, ...BOLD_CANDIDATES].join(', ')}.`,
    );
  }

  return {
    regular: new Uint8Array(readFileSync(regularPath)),
    bold: new Uint8Array(readFileSync(boldPath)),
  };
}

/** Whether a font pair is available, for a health check that runs before the first invoice. */
export function systemFontsAvailable(): boolean {
  try {
    resolveSystemFonts();
    return true;
  } catch {
    return false;
  }
}
