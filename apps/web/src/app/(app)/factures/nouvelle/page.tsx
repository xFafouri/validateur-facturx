import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { api, ApiError, type ClientOrgSummary } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { InvoiceForm } from './InvoiceForm';

export const metadata: Metadata = { title: 'Émettre une facture' };
export const dynamic = 'force-dynamic';

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ clientOrgId?: string }>;
}) {
  const { clientOrgId } = await searchParams;

  let clientOrgs: ClientOrgSummary[];
  try {
    clientOrgs = await api<ClientOrgSummary[]>('/client-orgs');
  } catch (error) {
    return (
      <Alert tone="error" title="Impossible de charger vos entreprises clientes">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  // Nothing to issue on behalf of; sending them to create one is more useful than an empty select.
  if (clientOrgs.length === 0) redirect('/clients/nouveau');

  const incomplete = clientOrgs.filter((org) => !org.addressLine1 || !org.postcode || !org.city);
  const selected = clientOrgs.find((org) => org.id === clientOrgId)?.id ?? clientOrgs[0]!.id;

  // The date the server would use, formatted in Paris time so it does not read as yesterday.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/factures" className="text-sm text-navy-600 hover:text-navy-900">
          ← Factures
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-navy-900">Émettre une facture</h1>
        <p className="mt-1 text-sm text-navy-600">
          Générée au format Factur-X (PDF/A-3 avec XML CII embarqué), vérifiée avant émission.
        </p>
      </div>

      {incomplete.length > 0 ? (
        <Alert tone="warn" title="Adresse manquante">
          <p>
            {incomplete.map((org) => org.name).join(', ')} n&apos;
            {incomplete.length > 1 ? 'ont' : 'a'} pas d&apos;adresse complète. La norme EN 16931
            exige l&apos;adresse du vendeur : une facture émise en son nom sera refusée avant
            d&apos;être enregistrée.
          </p>
          <p className="mt-2">
            <Link href="/clients" className="font-semibold underline">
              Compléter la fiche
            </Link>
          </p>
        </Alert>
      ) : null}

      <InvoiceForm clientOrgs={clientOrgs} defaultClientOrgId={selected} today={today} />
    </div>
  );
}
