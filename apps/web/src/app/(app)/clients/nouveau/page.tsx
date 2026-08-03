import Link from 'next/link';
import type { Metadata } from 'next';
import { Alert } from '@/components/ui/Form';
import { ClientOrgForm } from './ClientOrgForm';

export const metadata: Metadata = { title: 'Ajouter une entreprise' };
export const dynamic = 'force-dynamic';

export default async function NewClientOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ bienvenue?: string }>;
}) {
  const { bienvenue } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/clients" className="text-sm text-navy-600 hover:text-navy-900">
          ← Entreprises clientes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-navy-900">Ajouter une entreprise</h1>
        <p className="mt-1 text-sm text-navy-600">
          L&apos;entreprise au nom de laquelle les factures seront émises.
        </p>
      </div>

      {bienvenue ? (
        <Alert tone="info" title="Votre compte est créé">
          Ajoutez maintenant l&apos;entreprise qui figurera comme vendeur sur vos factures. Ses
          coordonnées sont reprises telles quelles sur chaque document émis — c&apos;est pourquoi
          elles sont enregistrées ici plutôt que ressaisies à chaque facture.
        </Alert>
      ) : null}

      <div className="rounded-lg border border-navy-100 bg-white p-6">
        <ClientOrgForm />
      </div>
    </div>
  );
}
