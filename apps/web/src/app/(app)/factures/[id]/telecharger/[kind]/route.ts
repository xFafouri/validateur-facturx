/**
 * Relays a sealed artifact from the API to the browser.
 *
 * A thin proxy rather than a redirect: the API is not exposed publicly, and a redirect would send
 * the browser somewhere it cannot reach. The session cookie is forwarded, so the API applies its
 * own tenant scoping and integrity check - this route never decides who may read what.
 */

import { NextResponse } from 'next/server';
import { apiDownload } from '@/lib/api';
import { requireUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = new Set(['pdf', 'xml']);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  // Redirects an unauthenticated visitor to sign-in rather than returning a bare 401 body: this
  // URL is followed by a browser navigation, not by a fetch.
  await requireUser();

  const { id, kind } = await params;
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: 'Type de fichier inconnu.' }, { status: 404 });
  }

  const upstream = await apiDownload(
    `/invoices/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(kind)}`,
  );

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json(
      {
        error:
          status === 404
            ? "Cette facture ou cet artefact n'existe pas."
            : "L'archive n'a pas pu être relue. Réessayez, puis signalez l'incident si cela persiste.",
      },
      { status },
    );
  }

  // Headers are copied from the API rather than rebuilt, so the filename and content type come
  // from the side that knows what it sealed.
  const headers = new Headers();
  for (const header of ['content-type', 'content-disposition', 'content-length']) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  headers.set('Cache-Control', 'private, no-store');

  return new NextResponse(upstream.body, { status: 200, headers });
}
