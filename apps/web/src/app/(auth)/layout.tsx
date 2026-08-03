import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * Sign-in and registration must never be indexed, whatever `NEXT_PUBLIC_ALLOW_INDEXING` says for
 * the marketing pages: a sign-in form in search results is a phishing lure with our name on it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-navy-50">
      <header className="border-b border-navy-100 bg-white">
        <div className="container-page flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-navy-800 text-sm font-bold text-white">
              FX
            </div>
            <span className="text-[15px] font-semibold text-navy-900">Validateur Factur-X</span>
          </Link>
          <Link href="/" className="text-sm text-navy-600 hover:text-navy-900">
            Retour au validateur
          </Link>
        </div>
      </header>

      <main id="contenu" className="flex flex-1 items-start justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
