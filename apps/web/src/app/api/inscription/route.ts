/**
 * Waitlist signup.
 *
 * The only place this application stores personal data, so the constraints are deliberate:
 *
 *  - An email, a self-declared persona, and the consent wording. Nothing else.
 *  - **No invoice data and no validation results.** The validator promises uploads are forgotten
 *    immediately; attaching a report to a lead record would silently break that.
 *  - The exact consent text is stored, not a boolean - proving consent means proving what was
 *    agreed to.
 *  - Signing up twice is not an error. Re-submitting the same address updates the record rather
 *    than leaking, via an error message, whether that address was already on the list.
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { SIGNUP_LIMIT, checkRateLimit, clientKeyFromHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROFILES = ['TPE', 'ACCOUNTANT', 'SOFTWARE_VENDOR', 'OTHER'] as const;
type LeadProfileValue = (typeof PROFILES)[number];

/**
 * Pragmatic email check.
 *
 * Deliberately permissive: the only authoritative test of an address is delivering to it, and a
 * strict pattern reliably rejects valid addresses (apostrophes, new TLDs, sub-addressing) - a bad
 * trade when the cost of a junk row is one row.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical maximum.
const MAX_CONSENT_LENGTH = 500;

function errorResponse(message: string, status: number, code: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export async function POST(request: Request) {
  const limit = checkRateLimit(clientKeyFromHeaders(request.headers), SIGNUP_LIMIT);
  if (!limit.allowed) {
    return errorResponse(
      'Trop de tentatives. Réessayez dans quelques minutes.',
      429,
      'rate_limited',
      {
        'Retry-After': String(limit.retryAfterSeconds),
      },
    );
  }

  if (!isDatabaseConfigured()) {
    // Never pretend to have registered someone we cannot store.
    return errorResponse(
      'Les inscriptions ne sont pas disponibles pour le moment. Réessayez plus tard.',
      503,
      'signups_unavailable',
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Requête invalide.', 400, 'bad_request');
  }

  const payload = body as {
    email?: unknown;
    profile?: unknown;
    source?: unknown;
    consentText?: unknown;
    consent?: unknown;
  };

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (email === '' || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return errorResponse('Adresse e-mail invalide.', 400, 'invalid_email');
  }

  // Consent must be affirmative and explicit; a missing flag is a refusal, never a default.
  if (payload.consent !== true) {
    return errorResponse(
      "Vous devez accepter d'être recontacté pour vous inscrire.",
      400,
      'consent_required',
    );
  }

  const consentText =
    typeof payload.consentText === 'string' && payload.consentText.trim() !== ''
      ? payload.consentText.trim().slice(0, MAX_CONSENT_LENGTH)
      : 'Consentement à être recontacté au sujet de la facturation électronique.';

  const profile: LeadProfileValue = PROFILES.includes(payload.profile as LeadProfileValue)
    ? (payload.profile as LeadProfileValue)
    : 'OTHER';

  const source =
    typeof payload.source === 'string' ? payload.source.trim().slice(0, 100) || null : null;

  try {
    const prisma = getPrisma();
    await prisma.lead.upsert({
      where: { email },
      // Re-consenting refreshes the record and clears any previous opt-out.
      //
      // `source` is only overwritten when a new one is supplied: it records where the lead first
      // came from, and letting a later signup blank it would destroy the attribution this table
      // exists to capture.
      update: {
        profile,
        consentText,
        consentedAt: new Date(),
        unsubscribedAt: null,
        ...(source ? { source } : {}),
      },
      create: { email, profile, source, consentText },
    });

    return NextResponse.json(
      { ok: true, message: 'Inscription enregistrée. Nous vous préviendrons.' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return errorResponse(
        'Les inscriptions sont temporairement indisponibles. Réessayez plus tard.',
        503,
        'signups_unavailable',
      );
    }
    console.error('[inscription] unexpected failure', error);
    return errorResponse("L'inscription a échoué. Réessayez plus tard.", 500, 'internal_error');
  }
}
