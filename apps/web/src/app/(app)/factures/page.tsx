import Link from 'next/link';
import type { Metadata } from 'next';
import { api, ApiError, type ClientOrgSummary, type InvoiceListPage } from '@/lib/api';
import { can } from '@facturx/auth';
import { Alert } from '@/components/ui/Form';
import { requireUser } from '@/lib/session';
import { InvoiceTable } from '@/components/app/InvoiceTable';

export const metadata: Metadata = { title: 'Factures' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/** Above this many businesses, the pill row stops being a filter and becomes a second list. */
const PILL_LIMIT = 12;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ clientOrgId?: string; page?: string; direction?: string }>;
}) {
  const actor = await requireUser();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Unset means both directions; `/factures` is the whole book, not just what we issued.
  const direction =
    params.direction === 'ISSUED' || params.direction === 'RECEIVED' ? params.direction : undefined;

  const query = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(skip) });
  if (params.clientOrgId) query.set('clientOrgId', params.clientOrgId);
  if (direction) query.set('direction', direction);

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
            {result.total} facture{result.total > 1 ? 's' : ''} scellée
            {result.total > 1 ? 's' : ''} dans votre archive.
          </p>
        </div>
        {clientOrgs.length > 0 && can(actor.role, 'invoice:issue') ? (
          <Link
            href="/factures/nouvelle"
            className="rounded bg-navy-800 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-900"
          >
            Émettre une facture
          </Link>
        ) : null}
      </div>

      <nav aria-label="Filtrer par sens" className="flex flex-wrap gap-2 text-sm">
        <FilterLink href={directionHref(params.clientOrgId, undefined)} active={!direction}>
          Toutes
        </FilterLink>
        <FilterLink
          href={directionHref(params.clientOrgId, 'ISSUED')}
          active={direction === 'ISSUED'}
        >
          Émises
        </FilterLink>
        <FilterLink
          href={directionHref(params.clientOrgId, 'RECEIVED')}
          active={direction === 'RECEIVED'}
        >
          Reçues
        </FilterLink>
      </nav>

      {/*
        Pills up to a point, then a select. An accountant with two hundred clients was previously
        given two hundred pills, which is not a filter but a second list to search — and the whole
        reason this page exists is that the first one is too long to read.

        The select submits as a plain GET form: no client component, no JavaScript required, and
        the resulting URL is the same shareable `?clientOrgId=` either way.
      */}
      {clientOrgs.length > 1 && clientOrgs.length <= PILL_LIMIT ? (
        <nav aria-label="Filtrer par entreprise" className="flex flex-wrap gap-2 text-sm">
          <FilterLink href={directionHref(undefined, direction)} active={!params.clientOrgId}>
            Toutes
          </FilterLink>
          {clientOrgs.map((org) => (
            <FilterLink
              key={org.id}
              href={directionHref(org.id, direction)}
              active={params.clientOrgId === org.id}
            >
              {org.name}
            </FilterLink>
          ))}
        </nav>
      ) : null}

      {clientOrgs.length > PILL_LIMIT ? (
        <form method="GET" action="/factures" className="flex flex-wrap items-end gap-2">
          {/* Preserved across the submit, or filtering by business would silently reset it. */}
          {direction ? <input type="hidden" name="direction" value={direction} /> : null}
          <div>
            <label
              htmlFor="clientOrgId"
              className="block text-xs font-medium uppercase tracking-wide text-navy-500"
            >
              Entreprise
            </label>
            <select
              id="clientOrgId"
              name="clientOrgId"
              defaultValue={params.clientOrgId ?? ''}
              className="mt-1 block w-full max-w-sm rounded border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200"
            >
              <option value="">Toutes les entreprises ({clientOrgs.length})</option>
              {clientOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-800 hover:bg-navy-50"
          >
            Filtrer
          </button>
        </form>
      ) : null}

      <InvoiceTable invoices={result.invoices} direction={direction} />

      {lastPage > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <PageLink
            enabled={page > 1}
            href={pageHref(params.clientOrgId, direction, page - 1)}
            label="← Précédentes"
          />
          <span className="text-navy-500">
            Page {page} sur {lastPage}
          </span>
          <PageLink
            enabled={page < lastPage}
            href={pageHref(params.clientOrgId, direction, page + 1)}
            label="Suivantes →"
          />
        </nav>
      ) : null}
    </div>
  );
}

/**
 * Carries *every* active filter into the next page, not just the business.
 *
 * `direction` used to be dropped here, so paging through "Émises" quietly widened the list back to
 * both directions — with the tab still highlighted, which is the version of this bug you do not
 * notice.
 */
function pageHref(
  clientOrgId: string | undefined,
  direction: string | undefined,
  page: number,
): string {
  const query = new URLSearchParams({ page: String(page) });
  if (clientOrgId) query.set('clientOrgId', clientOrgId);
  if (direction) query.set('direction', direction);
  return `/factures?${query}`;
}

function directionHref(clientOrgId: string | undefined, direction: string | undefined): string {
  const query = new URLSearchParams();
  if (clientOrgId) query.set('clientOrgId', clientOrgId);
  if (direction) query.set('direction', direction);
  const suffix = query.toString();
  return suffix === '' ? '/factures' : `/factures?${suffix}`;
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
