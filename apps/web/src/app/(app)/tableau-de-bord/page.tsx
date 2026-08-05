import Link from 'next/link';
import type { Metadata } from 'next';
import {
  api,
  ApiError,
  type ClientOrgOverview,
  type ClientOrgOverviewPage,
  type InvoiceListPage,
} from '@/lib/api';
import { can } from '@facturx/auth';
import { Alert } from '@/components/ui/Form';
import { requireUser } from '@/lib/session';
import { InvoiceTable } from '@/components/app/InvoiceTable';
import { BLOCKER_LABELS } from '@/lib/format';

export const metadata: Metadata = { title: "Vue d'ensemble" };
export const dynamic = 'force-dynamic';

/** Days between now and the first date large firms must be able to issue and everyone receive. */
const MANDATE_DATE = new Date('2026-09-01T00:00:00+02:00');

/**
 * Businesses listed by name before the rest are folded away.
 *
 * A cabinet with two hundred clients and forty problems needs the worst of them on screen, not all
 * forty — the rest are one click away on a page built to be paged through.
 */
const ATTENTION_SHOWN = 8;

export default async function DashboardPage() {
  const actor = await requireUser();
  const mayIssue = can(actor.role, 'invoice:issue');
  const mayAddClient = can(actor.role, 'clientOrg:create');

  let overview: ClientOrgOverviewPage;
  let recent: InvoiceListPage;
  let received: InvoiceListPage;

  try {
    [overview, recent, received] = await Promise.all([
      api<ClientOrgOverviewPage>('/client-orgs/overview'),
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

  const { totals } = overview;
  const daysToMandate = Math.ceil((MANDATE_DATE.getTime() - Date.now()) / 86_400_000);

  /*
    Worst first, and "worst" is ordered by what costs the most to leave alone: a parked
    transmission is an invoice the buyer has never seen, a non-conforming payable needs the
    supplier told, and an unready business cannot trade at all. Businesses with nothing wrong are
    excluded entirely rather than sorted to the bottom — this list is a worklist, not a directory.
  */
  const needingAttention = overview.clientOrgs
    .filter((org) => attentionScore(org) > 0)
    .sort(
      (left, right) =>
        right.stuck - left.stuck ||
        right.nonConforming - left.nonConforming ||
        right.blockers.length - left.blockers.length ||
        left.name.localeCompare(right.name, 'fr'),
    );

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

      {totals.clientOrgs === 0 && mayAddClient ? (
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

      {totals.clientOrgs > 0 ? <ToDo totals={totals} /> : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Entreprises clientes" value={String(totals.clientOrgs)} href="/clients" />
        <Stat
          label="Factures émises"
          value={String(totals.issued)}
          href="/factures?direction=ISSUED"
        />
        <Stat label="Factures reçues" value={String(totals.received)} href="/reception" />
      </section>

      {needingAttention.length > 0 ? <AttentionTable orgs={needingAttention} /> : null}

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
          {totals.clientOrgs > 0 && mayIssue ? (
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

/** How much this business is asking for. Only ever used to decide whether to list it, and where. */
function attentionScore(org: ClientOrgOverview): number {
  return org.stuck + org.nonConforming + org.blockers.length + (org.connection?.lastError ? 1 : 0);
}

/**
 * The worklist, above everything else on the page.
 *
 * Each row is a count, what it means, and the screen that resolves it. Anything at zero is not
 * rendered: a dashboard of green zeroes trains people to stop reading it, and the one number that
 * matters then arrives in the same typeface as eight that do not.
 */
function ToDo({ totals }: { totals: ClientOrgOverviewPage['totals'] }) {
  const items = [
    {
      count: totals.stuck,
      href: '/factures?direction=ISSUED',
      tone: 'error' as const,
      label: (n: number) =>
        `${n} facture${n > 1 ? 's' : ''} n'${n > 1 ? 'ont' : 'a'} pas pu être transmise${n > 1 ? 's' : ''}`,
      detail:
        "Les tentatives automatiques se sont arrêtées. Le destinataire ne l'a pas reçue et ne la recevra pas sans intervention.",
    },
    {
      count: totals.connectionsInError,
      href: '/raccordements',
      tone: 'error' as const,
      label: (n: number) => `${n} raccordement${n > 1 ? 's' : ''} en erreur`,
      detail:
        "Tant que la plateforme refuse le raccordement, les factures de ces entreprises resteront en file d'attente sans partir.",
    },
    {
      count: totals.nonConforming,
      href: '/factures?direction=RECEIVED',
      tone: 'warn' as const,
      label: (n: number) =>
        `${n} facture${n > 1 ? 's' : ''} reçue${n > 1 ? 's' : ''} non conforme${n > 1 ? 's' : ''}`,
      detail:
        "Conservées telles qu'elles ont été reçues. C'est à leur émetteur d'émettre une facture rectificative.",
    },
    {
      count: totals.notConnected,
      href: '/raccordements',
      tone: 'warn' as const,
      label: (n: number) => `${n} entreprise${n > 1 ? 's' : ''} sans plateforme`,
      detail:
        'Une entreprise non raccordée peut préparer des factures, mais aucune ne partira dans le circuit officiel.',
    },
    {
      count: totals.incomplete,
      href: '/clients',
      tone: 'warn' as const,
      label: (n: number) => `${n} entreprise${n > 1 ? 's' : ''} à l'adresse incomplète`,
      detail:
        'Une adresse de vendeur complète est exigée par la norme EN 16931 : sans elle, la facture est refusée à la validation.',
    },
  ].filter((item) => item.count > 0);

  if (items.length === 0) {
    return (
      <Alert tone="success" title="Rien ne demande votre attention">
        Aucune facture bloquée, aucune facture reçue non conforme, et toutes vos entreprises sont
        raccordées.
      </Alert>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-navy-900">À traiter</h2>
      <ul className="divide-y divide-navy-50 overflow-hidden rounded-lg border border-navy-100 bg-white">
        {items.map((item) => (
          <li key={item.href + item.tone + item.count}>
            <Link href={item.href} className="flex items-start gap-4 px-5 py-4 hover:bg-navy-50/60">
              <span
                className={`mt-0.5 shrink-0 rounded px-2 py-1 text-sm font-semibold tabular-nums ${
                  item.tone === 'error'
                    ? 'bg-signal-errorBg text-signal-error'
                    : 'bg-signal-warnBg text-signal-warn'
                }`}
              >
                {item.count}
              </span>
              <span>
                <span className="block text-sm font-medium text-navy-900">
                  {item.label(item.count)}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-navy-500">
                  {item.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Which businesses those totals belong to — the step between "40 problems" and opening one. */
function AttentionTable({ orgs }: { orgs: readonly ClientOrgOverview[] }) {
  const shown = orgs.slice(0, ATTENTION_SHOWN);
  const hidden = orgs.length - shown.length;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-navy-900">
        Entreprises concernées ({orgs.length})
      </h2>
      <div className="overflow-x-auto rounded-lg border border-navy-100 bg-white">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only">Entreprises demandant une intervention</caption>
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-500">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Entreprise
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                À traiter
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Factures
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((org) => (
              <tr key={org.id} className="border-b border-navy-50 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/factures?clientOrgId=${org.id}`}
                    className="font-medium text-navy-900 underline decoration-navy-200 underline-offset-2"
                  >
                    {org.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {org.stuck > 0 ? (
                      <Chip tone="error">
                        {org.stuck} bloquée{org.stuck > 1 ? 's' : ''}
                      </Chip>
                    ) : null}
                    {org.nonConforming > 0 ? (
                      <Chip tone="warn">
                        {org.nonConforming} non conforme{org.nonConforming > 1 ? 's' : ''}
                      </Chip>
                    ) : null}
                    {org.connection?.lastError ? <Chip tone="error">Raccordement KO</Chip> : null}
                    {org.blockers.map((blocker) => (
                      <Chip key={blocker} tone="warn">
                        {BLOCKER_LABELS[blocker] ?? blocker}
                      </Chip>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-navy-600">
                  {org.issued + org.received}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <p className="mt-3 text-sm">
          <Link href="/clients" className="text-navy-800 underline">
            {hidden} autre{hidden > 1 ? 's' : ''} entreprise{hidden > 1 ? 's' : ''} à traiter
          </Link>
        </p>
      ) : null}
    </section>
  );
}

function Chip({ tone, children }: { tone: 'error' | 'warn'; children: React.ReactNode }) {
  const styles =
    tone === 'error' ? 'bg-signal-errorBg text-signal-error' : 'bg-signal-warnBg text-signal-warn';
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
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
