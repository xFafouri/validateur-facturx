import Link from 'next/link';
import type { Metadata } from 'next';
import {
  CREDENTIAL_FAILURE_MESSAGES,
  MIN_PASSWORD_LENGTH,
  checkCredentialToken,
} from '@facturx/auth';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';
import { Alert } from '@/components/ui/Form';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata: Metadata = { title: 'Choisir un mot de passe' };
export const dynamic = 'force-dynamic';

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; invitation?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? '';
  const purpose = params.invitation === '1' ? 'INVITATION' : 'PASSWORD_RESET';

  /*
    Checked before the form is rendered, so an expired or already-used link says so immediately
    rather than after someone has typed a password twice. The check does not consume the token —
    that happens only on submit.
  */
  let failure: string | null = null;
  if (!isDatabaseConfigured()) {
    failure = 'Le service est momentanément indisponible. Réessayez plus tard.';
  } else {
    const check = await checkCredentialToken(getPrisma(), token, purpose);
    if (!check.ok) failure = CREDENTIAL_FAILURE_MESSAGES[check.reason];
  }

  return (
    <div className="rounded-lg border border-navy-100 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold text-navy-900">
        {purpose === 'INVITATION' ? 'Activer votre accès' : 'Choisir un nouveau mot de passe'}
      </h1>
      <p className="mt-1.5 text-sm text-navy-600">
        {purpose === 'INVITATION'
          ? 'Choisissez le mot de passe qui vous servira à vous connecter.'
          : 'Ce lien ne peut servir qu’une seule fois.'}
      </p>

      <div className="mt-6">
        {failure ? (
          <Alert tone="error" title="Ce lien ne fonctionne pas">
            <p>{failure}</p>
            <p className="mt-3">
              <Link href="/mot-de-passe-oublie" className="font-semibold underline">
                Demander un nouveau lien
              </Link>
            </p>
          </Alert>
        ) : (
          <SetPasswordForm
            token={token}
            purpose={purpose}
            minPasswordLength={MIN_PASSWORD_LENGTH}
          />
        )}
      </div>
    </div>
  );
}
