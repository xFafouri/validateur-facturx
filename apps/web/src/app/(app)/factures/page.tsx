import Link from 'next/link';
import type { Metadata } from 'next';
import { api, ApiError, type ClientOrgSummary, type InvoiceListPage } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { InvoiceTable } from '@/components/app/InvoiceTable';

export const metadata: Metadata = { title: 'Factures' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ clientOrgId?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const query = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(skip) });
  if (params.clientOrgId) query.set('clientOrgId', params.clientOrgId);

  let result: InvoiceListPage;
  let clientOrgs: ClientOrgSummary[];
  try {
    [result, clientOrgs] = await Promise.all([
      api<InvoiceListPage>(`/invoices?${query}`),
      api<ClientOrgSummary[]>('/client-orgs'),
    ]);
  } catch (error) {
    return (
      <Alert tone="error" title="Impossible de charger vos factures">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">Factures</h1>
          <p className="mt-1 text-sm text-navy-600">
            {result.total} facture{result.total > 1 ? 's' : ''} émise
            {result.total > 1 ? 's' : ''} et scellée{result.total > 1 ? 's' : ''}.
          </p>
        </div>
        {clientOrgs.length > 0 ? (
          <Link
            href="/factures/nouvelle"
            className="rounded bg-navy-800 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-900"
          >
            Émettre une facture
          </Link>
        ) : null}
      </div>

      {clientOrgs.length > 1 ? (
        <nav aria-label="Filtrer par entreprise" className="flex flex-wrap gap-2 text-sm">
          <FilterLink href="/factures" active={!params.clientOrgId}>
            Toutes
          </FilterLink>
          {clientOrgs.map((org) => (
            <FilterLink
              key={org.id}
              href={`/factures?clientOrgId=${org.id}`}
              active={params.clientOrgId === org.id}
            >
              {org.name}
            </FilterLink>
          ))}
        </nav>
      ) : null}

      <InvoiceTable invoices={result.invoices} />

      {lastPage > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <PageLink
            enabled={page > 1}
            href={pageHref(params.clientOrgId, page - 1)}
            label="← Précédentes"
          />
          <span className="text-navy-500">
            Page {page} sur {lastPage}
          </span>
          <PageLink
            enabled={page < lastPage}
            href={pageHref(params.clientOrgId, page + 1)}
            label="Suivantes →"
          />
        </nav>
      ) : null}
    </div>
  );
}

function pageHref(clientOrgId: string | undefined, page: number): string {
  const query = new URLSearchParams({ page: String(page) });
  if (clientOrgId) query.set('clientOrgId', clientOrgId);
  return `/factures?${query}`;
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full px-3 py-1 ${
        active
          ? 'bg-navy-800 font-medium text-white'
          : 'border border-navy-200 bg-white text-navy-700 hover:border-navy-300'
      }`}
    >
      {children}
    </Link>
  );
}

function PageLink({ enabled, href, label }: { enabled: boolean; href: string; label: string }) {
  if (!enabled) return <span className="text-navy-300">{label}</span>;
  return (
    <Link href={href} className="font-medium text-navy-800 underline">
      {label}
    </Link>
  );
}
