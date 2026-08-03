import Link from 'next/link';
import type { Metadata } from 'next';
import { api, ApiError, type ClientOrgSummary, type InvoiceListPage } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { InvoiceTable } from '@/components/app/InvoiceTable';
import { ReceiveForm } from './ReceiveForm';

export const metadata: Metadata = { title: 'Factures reçues' };
export const dynamic = 'force-dynamic';

/** Everyone must be able to receive from this date; issuing is phased in later. */
const RECEIVE_MANDATE = new Date('2026-09-01T00:00:00+02:00');

export default async function ReceptionPage() {
  let received: InvoiceListPage;
  let clientOrgs: ClientOrgSummary[];

  try {
    [received, clientOrgs] = await Promise.all([
      api<InvoiceListPage>('/invoices?direction=RECEIVED&take=25'),
      api<ClientOrgSummary[]>('/client-orgs'),
    ]);
  } catch (error) {
    return (
      <Alert tone="error" title="Impossible de charger les factures reçues">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  const days = Math.ceil((RECEIVE_MANDATE.getTime() - Date.now()) / 86_400_000);
  const nonConforming = received.invoices.filter(
    (invoice) => invoice.lastValidationValid === false,
  ).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Factures reçues</h1>
        <p className="mt-1 text-sm text-navy-600">
          {days > 0
            ? `Toutes les entreprises assujetties à la TVA doivent être en capacité de recevoir des factures électroniques dans ${days} jours.`
            : "L'obligation de réception s'applique à toutes les entreprises assujetties à la TVA."}
        </p>
      </div>

      {clientOrgs.length === 0 ? (
        <Alert tone="info" title="Ajoutez d'abord une entreprise">
          <p>
            Une facture reçue est rattachée automatiquement à l&apos;entreprise qu&apos;elle désigne
            comme destinataire, d&apos;après son SIRET ou son SIREN. Sans entreprise enregistrée, il
            n&apos;y a rien à quoi la rattacher.
          </p>
          <p className="mt-3">
            <Link href="/clients/nouveau" className="font-semibold underline">
              Ajouter une entreprise cliente
            </Link>
          </p>
        </Alert>
      ) : (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy-900">Déposer une facture reçue</h2>
          <ReceiveForm />
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-navy-900">Reçues ({received.total})</h2>
          {nonConforming > 0 ? (
            <span className="rounded bg-signal-warnBg px-2.5 py-1 text-xs font-medium text-signal-warn">
              {nonConforming} non conforme{nonConforming > 1 ? 's' : ''} parmi les dernières
            </span>
          ) : null}
        </div>

        <InvoiceTable invoices={received.invoices} direction="RECEIVED" />

        {received.total > received.invoices.length ? (
          <p className="mt-3 text-sm">
            <Link href="/factures?direction=RECEIVED" className="text-navy-800 underline">
              Voir toutes les factures reçues
            </Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}
