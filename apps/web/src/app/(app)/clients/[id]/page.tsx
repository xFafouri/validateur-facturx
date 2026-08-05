import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { can } from '@facturx/auth';
import { api, ApiError, type ClientOrgDetail, type InvoiceListPage } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { InvoiceTable } from '@/components/app/InvoiceTable';
import { requireUser } from '@/lib/session';
import { BLOCKER_LABELS, formatSirenDisplay, formatSiretDisplay } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const org = await api<ClientOrgDetail>(`/client-orgs/${id}`);
    return { title: org.name };
  } catch {
    return { title: 'Entreprise cliente' };
  }
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, actor] = await Promise.all([params, requireUser()]);

  let org: ClientOrgDetail;
  try {
    org = await api<ClientOrgDetail>(`/client-orgs/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <Alert tone="error" title="Impossible de charger cette entreprise">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  // After the business resolves, not alongside it: fetching invoices for an id that turns out to
  // be out of scope is a query we had no business running.
  const invoices = await api<InvoiceListPage>(
    `/invoices?clientOrgId=${encodeURIComponent(org.id)}&take=10`,
  ).catch(() => null);

  const { status } = org;
  const mayIssue = can(actor.role, 'invoice:issue');
  const mayManagePdp = can(actor.role, 'pdp:manage');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/clients" className="text-sm text-navy-600 hover:text-navy-900">
          ← Entreprises clientes
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-navy-900">{org.name}</h1>
            <p className="mt-1 text-sm tabular-nums text-navy-600">
              SIREN {formatSirenDisplay(org.siren)}
            </p>
          </div>
          {mayIssue ? (
            <Link
              href={`/factures/nouvelle?clientOrgId=${org.id}`}
              className="rounded bg-navy-800 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-900"
            >
              Émettre une facture
            </Link>
          ) : null}
        </div>
      </div>

      {/*
        The blockers first, and each one paired with the screen that clears it. A page that reports
        a business is not ready without saying where to go leaves the user exactly where they were.
      */}
      {status.blockers.length > 0 ? (
        <Alert tone="warn" title="Cette entreprise n'est pas prête">
          <ul className="ml-4 list-disc space-y-1">
            {status.blockers.map((blocker) => (
              <li key={blocker}>
                <strong>{BLOCKER_LABELS[blocker] ?? blocker}</strong>
                {blocker === 'ADRESSE_INCOMPLETE' ? (
                  <>
                    {' '}
                    — la norme EN 16931 exige une adresse de vendeur complète. Sans elle, toute
                    facture émise sera refusée à la validation.
                  </>
                ) : null}
                {blocker === 'AUCUN_RACCORDEMENT' ? (
                  <>
                    {' '}
                    — les factures peuvent être préparées et scellées, mais aucune ne partira dans
                    le circuit officiel.{' '}
                    {mayManagePdp ? (
                      <Link href="/raccordements" className="font-semibold underline">
                        Raccorder cette entreprise
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {status.stuck > 0 ? (
        <Alert tone="error" title="Des factures ne sont pas parties">
          {status.stuck} facture{status.stuck > 1 ? 's' : ''} de cette entreprise{' '}
          {status.stuck > 1 ? 'ont' : 'a'} épuisé ses tentatives de transmission. Le destinataire ne
          l&apos;a pas reçue.{' '}
          <Link
            href={`/factures?clientOrgId=${org.id}&direction=ISSUED`}
            className="font-semibold underline"
          >
            Voir les factures émises
          </Link>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="Émises"
          value={status.issued}
          href={`/factures?clientOrgId=${org.id}&direction=ISSUED`}
        />
        <Stat
          label="Reçues"
          value={status.received}
          href={`/factures?clientOrgId=${org.id}&direction=RECEIVED`}
        />
        <Stat
          label="En attente d’envoi"
          value={status.queued}
          tone={status.queued > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Reçues non conformes"
          value={status.nonConforming}
          tone={status.nonConforming > 0 ? 'warn' : undefined}
          href={`/factures?clientOrgId=${org.id}&direction=RECEIVED`}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-navy-100 bg-white p-5">
          <h2 className="text-sm font-semibold text-navy-900">Identité</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="SIRET" value={formatSiretDisplay(org.siret)} />
            <Row label="TVA" value={org.vatNumber ?? '—'} />
            <Row label="Profil émis" value={org.defaultProfile} />
            <Row
              label="Adresse de routage"
              value={
                org.eInvoicingAddress
                  ? `${org.eInvoicingAddress}${org.eInvoicingScheme ? ` (${org.eInvoicingScheme})` : ''}`
                  : '—'
              }
            />
          </dl>
          <div className="mt-4 border-t border-navy-50 pt-3">
            <p className="text-xs text-navy-500">Adresse</p>
            {org.addressLine1 ? (
              <address className="mt-1 text-sm not-italic leading-relaxed text-navy-800">
                {org.addressLine1}
                {org.addressLine2 ? (
                  <>
                    <br />
                    {org.addressLine2}
                  </>
                ) : null}
                <br />
                {[org.postcode, org.city].filter(Boolean).join(' ')}
                {org.countryCode && org.countryCode !== 'FR' ? ` (${org.countryCode})` : ''}
              </address>
            ) : (
              <p className="mt-1 text-sm text-signal-warn">Manquante — nécessaire pour émettre</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-navy-100 bg-white p-5">
          <h2 className="text-sm font-semibold text-navy-900">Raccordement</h2>
          {status.connection ? (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Plateforme" value={status.connection.provider} />
                <Row label="Libellé" value={status.connection.label ?? '—'} />
                <Row
                  label="Vérification"
                  value={status.connection.verified ? 'Vérifié' : 'Jamais vérifié'}
                />
              </dl>
              {status.connection.lastError ? (
                <p className="mt-3 break-words rounded bg-signal-errorBg px-3 py-2 font-mono text-xs text-signal-error">
                  {status.connection.lastError}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-navy-600">
              Aucune plateforme active. Les factures resteront en file d&apos;attente.
            </p>
          )}
          {mayManagePdp ? (
            <p className="mt-4 border-t border-navy-50 pt-3 text-sm">
              <Link href="/raccordements" className="font-medium text-navy-800 underline">
                Gérer les raccordements
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-navy-900">Dernières factures</h2>
          <Link
            href={`/factures?clientOrgId=${org.id}`}
            className="text-sm font-medium text-navy-800 underline"
          >
            Toutes les factures ({status.issued + status.received})
          </Link>
        </div>
        {invoices ? (
          <InvoiceTable invoices={invoices.invoices} />
        ) : (
          <Alert tone="error">
            Les factures de cette entreprise n&apos;ont pas pu être chargées.
          </Alert>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-navy-500">{label}</dt>
      <dd className="text-right text-navy-900">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href?: string;
  tone?: 'warn';
}) {
  const body = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</div>
      <div
        className={`mt-1.5 text-2xl font-semibold tabular-nums ${
          tone === 'warn' ? 'text-signal-warn' : 'text-navy-900'
        }`}
      >
        {value}
      </div>
    </>
  );

  // Only linked when there is somewhere useful to go; a zero that navigates to an empty list is a
  // worse answer than a zero that sits still.
  if (!href || value === 0) {
    return <div className="rounded-lg border border-navy-100 bg-white p-4">{body}</div>;
  }

  return (
    <Link
      href={href}
      className="rounded-lg border border-navy-100 bg-white p-4 transition-colors hover:border-navy-200"
    >
      {body}
    </Link>
  );
}
