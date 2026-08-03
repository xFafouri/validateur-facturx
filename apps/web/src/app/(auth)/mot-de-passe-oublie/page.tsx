import Link from 'next/link';
import type { Metadata } from 'next';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = { title: 'Mot de passe oublié' };
export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-lg border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-navy-900">Mot de passe oublié</h1>
      <p className="mt-1.5 text-sm text-navy-600">
        Indiquez votre adresse e-mail : nous vous enverrons un lien pour choisir un nouveau mot de
        passe.
      </p>

      <div className="mt-6">
        <ForgotForm />
      </div>

      <p className="mt-6 border-t border-navy-100 pt-5 text-sm text-navy-600">
        <Link href="/connexion" className="font-medium text-navy-800 underline">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
