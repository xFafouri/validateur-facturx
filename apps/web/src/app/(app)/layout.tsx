import Link from 'next/link';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { signOut } from '../(auth)/actions';

/** A tenant's own data. Never indexed, whatever the marketing pages are set to. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/tableau-de-bord', label: "Vue d'ensemble" },
  { href: '/clients', label: 'Entreprises clientes' },
  { href: '/factures', label: 'Factures émises' },
  { href: '/reception', label: 'Factures reçues' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every page under this layout is behind it. Guarding here rather than page by page means a new
  // page cannot be added unguarded by accident.
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col bg-navy-50">
      <header className="border-b border-navy-100 bg-white">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-6">
            <Link href="/tableau-de-bord" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-navy-800 text-sm font-bold text-white">
                FX
              </div>
              <span className="text-[15px] font-semibold text-navy-900">Factur-X</span>
            </Link>

            <nav aria-label="Navigation principale" className="hidden gap-5 text-sm sm:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-navy-600 hover:text-navy-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-navy-500 md:inline" title={user.email}>
              {user.name ?? user.email}
            </span>
            <form action={signOut}>
              <button type="submit" className="text-navy-600 underline hover:text-navy-900">
                Se déconnecter
              </button>
            </form>
          </div>
        </div>

        <nav
          aria-label="Navigation principale"
          className="container-page flex gap-5 pb-3 text-sm sm:hidden"
        >
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="text-navy-600 hover:text-navy-900">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="contenu" className="container-page flex-1 py-8">
        {children}
      </main>

      <footer className="border-t border-navy-100 bg-white py-5">
        <div className="container-page text-xs leading-relaxed text-navy-500">
          Les factures émises sont vérifiées avant émission puis scellées dans une archive
          inaltérable, conservée dix ans (art. L123-22 du Code de commerce).
        </div>
      </footer>
    </div>
  );
}
