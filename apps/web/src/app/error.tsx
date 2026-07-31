'use client';

import { useEffect } from 'react';

/**
 * Client-side error boundary.
 *
 * Shows the digest rather than the message: Next redacts server error messages in production
 * anyway, and the digest is what actually lets someone correlate a user's report with a server
 * log. A raw stack trace would be both useless to a small-business owner and a disclosure risk.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[page error]', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-950 px-4 text-center">
      <div className="max-w-md">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-400">Erreur</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Une erreur est survenue</h1>
        <p className="mt-3 text-navy-200">
          Le problème vient de notre côté, pas de votre facture. Vous pouvez réessayer.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-100"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="rounded-lg border border-white/30 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Retour à l&apos;accueil
          </a>
        </div>

        {error.digest && (
          <p className="mt-6 font-mono text-xs text-navy-400">Référence : {error.digest}</p>
        )}
      </div>
    </main>
  );
}
