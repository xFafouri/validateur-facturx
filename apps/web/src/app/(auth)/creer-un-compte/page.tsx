import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { MIN_PASSWORD_LENGTH } from '@facturx/auth';
import { currentUser } from '@/lib/session';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = { title: 'Créer un compte' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await currentUser()) redirect('/tableau-de-bord');

  return (
    <div className="rounded-lg border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-navy-900">Créer un compte</h1>
      <p className="mt-1.5 text-sm text-navy-600">
        Émettez des factures Factur-X conformes, vérifiées avant émission et archivées dix ans.
      </p>

      <div className="mt-6">
        <RegisterForm minPasswordLength={MIN_PASSWORD_LENGTH} />
      </div>

      <p className="mt-6 border-t border-navy-100 pt-5 text-sm text-navy-600">
        Vous avez déjà un compte ?{' '}
        <Link href="/connexion" className="font-medium text-navy-800 underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
