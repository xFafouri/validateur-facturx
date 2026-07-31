import Link from 'next/link';

export const metadata = {
  title: 'Page introuvable',
};

/** Next's default 404 is in English; on a French-first site that alone reads as a broken page. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-950 px-4 text-center">
      <div className="max-w-md">
        <p className="text-sm font-semibold uppercase tracking-wide text-orange-400">Erreur 404</p>
        <h1 className="mt-3 text-3xl font-bold text-white">Cette page n&apos;existe pas</h1>
        <p className="mt-3 text-navy-200">
          Le lien est peut-être incorrect ou la page a été déplacée.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-100"
        >
          Retour au validateur
        </Link>
      </div>
    </main>
  );
}
