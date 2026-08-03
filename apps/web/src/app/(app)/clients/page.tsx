import Link from 'next/link';
import type { Metadata } from 'next';
import { api, ApiError, type ClientOrgSummary } from '@/lib/api';
import { can } from '@facturx/auth';
import { Alert } from '@/components/ui/Form';
import { requireUser } from '@/lib/session';
import { formatSirenDisplay, formatSiretDisplay } from '@/lib/format';

export const metadata: Metadata = { title: 'Entreprises clientes' };
export const dynamic = 'force-dynamic';

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ ajoutee?: string }>;
}) {
  const actor = await requireUser();
  const { ajoutee } = await searchParams;
  const mayAdd = can(actor.role, 'clientOrg:create');
  const mayIssue = can(actor.role, 'invoice:issue');

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">Entreprises clientes</h1>
          <p className="mt-1 text-sm text-navy-600">
            Les entreprises pour lesquelles vous émettez des factures.
          </p>
        </div>
        {mayAdd ? (
          <Link
            href="/clients/nouveau"
            className="rounded bg-navy-800 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-900"
          >
            Ajouter une entreprise
          </Link>
        ) : null}
      </div>

      {ajoutee ? (
        <Alert tone="success">
          <strong>{ajoutee}</strong> a été ajoutée. Vous pouvez maintenant émettre des factures en
          son nom.
        </Alert>
      ) : null}

      {clientOrgs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy-200 bg-white px-6 py-10 text-center">
          <p className="text-sm text-navy-600">
            {mayAdd
              ? 'Aucune entreprise cliente pour le moment.'
              : 'Aucune entreprise ne vous a été attribuée. Contactez le cabinet qui gère votre compte.'}
          </p>
          {mayAdd ? (
            <Link
              href="/clients/nouveau"
              className="mt-3 inline-block text-sm font-semibold text-navy-800 underline"
            >
              Ajouter la première
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clientOrgs.map((org) => (
            <li key={org.id} className="rounded-lg border border-navy-100 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold text-navy-900">{org.name}</h2>
                <span className="shrink-0 rounded bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-600">
                  {org.defaultProfile}
                </span>
              </div>

              <dl className="mt-3 space-y-1 text-sm">
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-navy-500">SIREN</dt>
                  <dd className="tabular-nums text-navy-800">{formatSirenDisplay(org.siren)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-navy-500">SIRET</dt>
                  <dd className="tabular-nums text-navy-800">{formatSiretDisplay(org.siret)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-navy-500">Adresse</dt>
                  <dd className="text-navy-800">
                    {org.addressLine1 ? (
                      <>
                        {org.addressLine1}
                        {org.postcode || org.city ? (
                          <>
                            <br />
                            {[org.postcode, org.city].filter(Boolean).join(' ')}
                          </>
                        ) : null}
                      </>
                    ) : (
                      // Not decoration: without an address the seller fails EN 16931, so the
                      // omission has to read as a problem rather than as a blank field.
                      <span className="text-signal-warn">Manquante — nécessaire pour émettre</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex items-center justify-between border-t border-navy-50 pt-3 text-sm">
                <span className="text-navy-500">
                  {org._count.invoices} facture{org._count.invoices > 1 ? 's' : ''}
                </span>
                {mayIssue ? (
                  <Link
                    href={`/factures/nouvelle?clientOrgId=${org.id}`}
                    className="font-medium text-navy-800 underline"
                  >
                    Émettre une facture
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
