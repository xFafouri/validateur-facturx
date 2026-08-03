import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Alert } from '@/components/ui/Form';
import { currentUser } from '@/lib/session';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Connexion' };
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; motdepasse?: string; acces?: string }>;
}) {
  const { next, motdepasse, acces } = await searchParams;

  // Already signed in: send them on rather than showing a form that would open a second session.
  if (await currentUser()) redirect(safeNext(next));

  return (
    <div className="rounded-lg border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-navy-900">Connexion</h1>
      <p className="mt-1.5 text-sm text-navy-600">
        Accédez à vos entreprises clientes et à vos factures émises.
      </p>

      {/* Set by the redirect out of the set-password flow, which cannot confirm in place. */}
      {motdepasse === 'modifie' ? (
        <div className="mt-5">
          <Alert tone="success" title="Mot de passe modifié">
            Toutes vos sessions ont été fermées. Connectez-vous avec votre nouveau mot de passe.
          </Alert>
        </div>
      ) : null}

      {acces === 'active' ? (
        <div className="mt-5">
          <Alert tone="success" title="Accès activé">
            Votre mot de passe est enregistré. Vous pouvez maintenant vous connecter.
          </Alert>
        </div>
      ) : null}

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
