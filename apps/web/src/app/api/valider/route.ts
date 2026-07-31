/**
 * Public validation endpoint.
 *
 * Deliberately unauthenticated: the free validator is the top of the funnel and demanding a signup
 * to see whether your invoice is valid would defeat its purpose.
 *
 * Nothing is persisted. Invoices contain commercial and personal data, and a user handing a
 * document to an anonymous web tool has not consented to it being stored - so the bytes live only
 * for the duration of the request. That is also what makes the "no signup" promise honest.
 */

import { NextResponse } from 'next/server';
import { analyze, toAnalysisDto } from '@facturx/core';
import { MAX_UPLOAD_BYTES, getEngine } from '@/lib/engine';
import { VALIDATION_LIMIT, checkRateLimit, clientKeyFromHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uploads are transient, but a runaway file still costs CPU in Schematron evaluation. */
export const maxDuration = 60;

function errorResponse(message: string, status: number, code: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function POST(request: Request) {
  // Checked before the body is read: the point is to avoid spending work on abusive callers, and
  // parsing a 20 MB multipart body is already work.
  const limit = checkRateLimit(clientKeyFromHeaders(request.headers), VALIDATION_LIMIT);
  if (!limit.allowed) {
    return errorResponse(
      `Trop de validations en peu de temps. Réessayez dans ${limit.retryAfterSeconds} seconde${
        limit.retryAfterSeconds > 1 ? 's' : ''
      }.`,
      429,
      'rate_limited',
      { 'Retry-After': String(limit.retryAfterSeconds) },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(
      "La requête n'a pas pu être lue. Réessayez avec un fichier plus petit.",
      400,
      'bad_request',
    );
  }

  const file = formData.get('fichier');
  if (!(file instanceof File)) {
    return errorResponse('Aucun fichier reçu.', 400, 'no_file');
  }
  if (file.size === 0) {
    return errorResponse('Le fichier est vide.', 400, 'empty_file');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(
      `Le fichier dépasse la taille maximale de ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo.`,
      413,
      'too_large',
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const result = await analyze(bytes, file.name || 'facture', { engine: getEngine() });
    return NextResponse.json(toAnalysisDto(result), {
      headers: {
        // A validation verdict is specific to one upload and must never be cached or shared.
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    });
  } catch (error) {
    // analyze() handles document-level problems internally, so reaching here means a genuine
    // server fault. Log it, but never echo internals back to an anonymous caller.
    console.error('[valider] unexpected failure', error);
    return errorResponse(
      "Une erreur interne est survenue pendant l'analyse. Réessayez dans quelques instants.",
      500,
      'internal_error',
    );
  }
}

export async function GET() {
  const health = await getEngine().health();
  return NextResponse.json(
    {
      service: 'validateur Factur-X',
      engine: health.ok ? 'disponible' : 'indisponible',
      detail: health.detail ?? null,
    },
    { status: health.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
