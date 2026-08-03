import Link from 'next/link';
import type { Metadata } from 'next';
import { api, ApiError, type ClientOrgSummary, type InvoiceListPage } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { InvoiceTable } from '@/components/app/InvoiceTable';

export const metadata: Metadata = { title: "Vue d'ensemble" };
export const dynamic = 'force-dynamic';

/** Days between now and the first date large firms must be able to issue and everyone receive. */
const MANDATE_DATE = new Date('2026-09-01T00:00:00+02:00');

export default async function DashboardPage() {
  let clientOrgs: ClientOrgSummary[];
  let recent: InvoiceListPage;
  let received: InvoiceListPage;

  try {
    [clientOrgs, recent, received] = await Promise.all([
      api<ClientOrgSummary[]>('/client-orgs'),
      api<InvoiceListPage>('/invoices?direction=ISSUED&take=5'),
      api<InvoiceListPage>('/invoices?direction=RECEIVED&take=5'),
    ]);
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : 'Le service de facturation est injoignable.';
    return (
      <Alert tone="error" title="Impossible de charger vos données">
        {message}
      </Alert>
    );
  }

  const daysToMandate = Math.ceil((MANDATE_DATE.getTime() - Date.now()) / 86_400_000);
  const nonConforming = received.invoices.filter(
    (invoice) => invoice.lastValidationValid === false,
  ).length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Vue d&apos;ensemble</h1>
        <p className="mt-1 text-sm text-navy-600">
          {daysToMandate > 0
            ? `Plus que ${daysToMandate} jours avant le 1er septembre 2026.`
            : "L'obligation de réception est en vigueur depuis le 1er septembre 2026."}
        </p>
      </div>

      {clientOrgs.length === 0 ? (
        <Alert tone="info" title="Commencez par ajouter une entreprise">
          <p>
            Une facture est émise <em>au nom d&apos;une entreprise</em> : c&apos;est elle qui figure
            comme vendeur, et ses coordonnées sont reprises telles quelles sur le document. Rien ne
            peut être émis tant qu&apos;il n&apos;y en a pas.
          </p>
          <p className="mt-3">
            <Link href="/clients/nouveau" className="font-semibold underline">
              Ajouter une entreprise cliente
            </Link>
          </p>
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Entreprises clientes" value={String(clientOrgs.length)} href="/clients" />
        <Stat
          label="Factures émises"
          value={String(recent.total)}
          href="/factures?direction=ISSUED"
        />
        <Stat label="Factures reçues" value={String(received.total)} href="/reception" />
      </section>

      {nonConforming > 0 ? (
        <Alert tone="warn" title="Des factures reçues ne sont pas conformes">
          <p>
            {nonConforming} des dernières factures reçues comporte
            {nonConforming > 1 ? 'nt' : ''} des erreurs de conformité. Elles sont archivées telles
            quelles ; il revient à leur émetteur de les rectifier.
          </p>
          <p className="mt-2">
            <Link href="/reception" className="font-semibold underline">
              Voir les factures reçues
            </Link>
          </p>
        </Alert>
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-900">Dernières factures reçues</h2>
          <Link href="/reception" className="text-sm font-medium text-navy-800 underline">
            Déposer une facture reçue
          </Link>
        </div>
        <InvoiceTable invoices={received.invoices} direction="RECEIVED" />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-900">Dernières factures émises</h2>
          {clientOrgs.length > 0 ? (
            <Link
              href="/factures/nouvelle"
              className="rounded bg-navy-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-900"
            >
              Émettre une facture
            </Link>
          ) : null}
        </div>
        <InvoiceTable invoices={recent.invoices} direction="ISSUED" />
      </section>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-navy-100 bg-white p-4 transition-colors hover:border-navy-200"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums text-navy-900">{value}</div>
    </Link>
  );
}
