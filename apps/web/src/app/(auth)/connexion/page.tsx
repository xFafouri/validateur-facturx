import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentUser } from '@/lib/session';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Already signed in: send them on rather than showing a form that would open a second session.
  if (await currentUser()) redirect(safeNext(next));

  return (
    <div className="rounded-lg border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-navy-900">Connexion</h1>
      <p className="mt-1.5 text-sm text-navy-600">
        Accédez à vos entreprises clientes et à vos factures émises.
      </p>

      <div className="mt-6">
        <SignInForm next={safeNext(next)} />
      </div>

      <p className="mt-6 border-t border-navy-100 pt-5 text-sm text-navy-600">
        Pas encore de compte ?{' '}
        <Link href="/creer-un-compte" className="font-medium text-navy-800 underline">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}

/** Same rule as the action: only same-origin paths, so `?next=` cannot become an open redirect. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/tableau-de-bord';
  return next;
}
