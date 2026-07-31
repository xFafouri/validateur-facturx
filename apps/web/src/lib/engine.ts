import { MustangEngine } from '@facturx/core';

/**
 * Shared validation engine instance.
 *
 * Module-scoped so the Next.js server reuses one client across requests rather than rebuilding it
 * per upload. The engine itself is stateless; this only avoids repeated construction.
 */
let engine: MustangEngine | null = null;

export function getEngine(): MustangEngine {
  if (!engine) {
    engine = new MustangEngine({
      baseUrl: process.env.VALIDATOR_URL ?? 'http://127.0.0.1:8081',
      timeoutMs: Number(process.env.VALIDATOR_TIMEOUT_MS ?? 30_000),
    });
  }
  return engine;
}

/** Upload cap. Factur-X invoices are tens of kilobytes; anything near this is not one. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
