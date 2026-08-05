import Link from 'next/link';
import type { Metadata } from 'next';
import { can } from '@facturx/auth';
import {
  api,
  ApiError,
  type ClientOrgSummary,
  type PdpConnectionRecord,
  type PdpProviderOption,
} from '@/lib/api';
import { Alert, Button } from '@/components/ui/Form';
import { requireUser } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { ConnectionForm } from './ConnectionForm';
import { deactivateConnection, verifyConnection } from './actions';

export const metadata: Metadata = { title: 'Raccordements' };
export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const actor = await requireUser();
  const mayManage = can(actor.role, 'pdp:manage');

  let providers: { providers: PdpProviderOption[] };
  let connections: { connections: PdpConnectionRecord[] };
  let clientOrgs: ClientOrgSummary[];

  try {
    [providers, connections, clientOrgs] = await Promise.all([
      api<{ providers: PdpProviderOption[] }>('/pdp/providers'),
      api<{ connections: PdpConnectionRecord[] }>('/pdp/connections'),
      api<ClientOrgSummary[]>('/client-orgs'),
    ]);
  } catch (error) {
    return (
      <Alert tone="error" title="Impossible de charger les raccordements">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  const byClientOrg = new Map<string, PdpConnectionRecord[]>();
  for (const connection of connections.connections) {
    const existing = byClientOrg.get(connection.clientOrgId);
    if (existing) existing.push(connection);
    else byClientOrg.set(connection.clientOrgId, [connection]);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Raccordements aux plateformes</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-navy-600">
          Chaque entreprise transmet ses factures par une plateforme agréée. Nous préparons et
          scellons les documents, puis les remettons à cette plateforme : c&apos;est elle qui
          dialogue avec l&apos;administration, jamais nous directement.
        </p>
      </div>

      {clientOrgs.length === 0 ? (
        <Alert tone="info" title="Ajoutez d'abord une entreprise">
          <p>
            Un raccordement appartient à une entreprise cliente : ce sont ses factures qui partent
            par la plateforme, et ses identifiants qui sont enregistrés.
          </p>
          <p className="mt-3">
            <Link href="/clients/nouveau" className="font-semibold underline">
              Ajouter une entreprise cliente
            </Link>
          </p>
        </Alert>
      ) : (
        <ul className="space-y-4">
          {clientOrgs.map((org) => (
            <li key={org.id} className="rounded-lg border border-navy-100 bg-white p-5">
              <ClientOrgConnections
                org={org}
                connections={byClientOrg.get(org.id) ?? []}
                providers={providers.providers}
                mayManage={mayManage}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClientOrgConnections({
  org,
  connections,
  providers,
  mayManage,
}: {
  org: ClientOrgSummary;
  connections: readonly PdpConnectionRecord[];
  providers: readonly PdpProviderOption[];
  mayManage: boolean;
}) {
  const active = connections.find((connection) => connection.active);
  const inactive = connections.filter((connection) => !connection.active);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-navy-900">{org.name}</h2>
          <p className="mt-0.5 text-xs text-navy-500">
            {active
              ? `Raccordée à ${displayName(providers, active.provider)}`
              : 'Aucune plateforme active'}
          </p>
        </div>
        {active ? <VerificationBadge connection={active} /> : <NotConnectedBadge />}
      </div>

      {active ? <ConnectionDetail connection={active} mayManage={mayManage} /> : null}

      {/*
        A business that has switched platforms keeps its old rows: they are what its past
        transmissions point at, and deleting one would orphan the evidence of a delivery.
      */}
      {inactive.length > 0 ? (
        <p className="mt-3 border-t border-navy-50 pt-3 text-xs text-navy-500">
          Raccordement{inactive.length > 1 ? 's' : ''} désactivé
          {inactive.length > 1 ? 's' : ''} et conservé{inactive.length > 1 ? 's' : ''} :{' '}
          {inactive.map((connection) => displayName(providers, connection.provider)).join(', ')}.
        </p>
      ) : null}

      {mayManage ? (
        <details className="mt-4 border-t border-navy-50 pt-4">
          <summary className="cursor-pointer text-sm font-medium text-navy-800">
            {active ? 'Modifier le raccordement' : 'Raccorder cette entreprise'}
          </summary>
          <div className="mt-4">
            <ConnectionForm clientOrgId={org.id} providers={providers} connection={active} />
          </div>
        </details>
      ) : (
        <p className="mt-4 border-t border-navy-50 pt-3 text-xs text-navy-500">
          Seuls le propriétaire et les collaborateurs du cabinet peuvent modifier un raccordement.
        </p>
      )}
    </>
  );
}

function ConnectionDetail({
  connection,
  mayManage,
}: {
  connection: PdpConnectionRecord;
  mayManage: boolean;
}) {
  return (
    <>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-sm">
        {connection.label ? (
          <div>
            <dt className="text-xs text-navy-500">Libellé</dt>
            <dd className="text-navy-900">{connection.label}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-navy-500">Identifiants</dt>
          <dd className="text-navy-900">
            {/*
              Whether a secret is set, never what it is. The API refuses to return the value at
              all, which is what makes encrypting it at rest worth anything.
            */}
            {connection.hasCredentials ? 'Enregistrés et chiffrés' : 'Aucun'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-navy-500">URL de l’API</dt>
          <dd className="break-all text-navy-900">{connection.apiBaseUrl ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-navy-500">Dernière interrogation</dt>
          <dd className="text-navy-900">{formatDateTime(connection.lastPolledAt)}</dd>
        </div>
      </dl>

      {connection.lastError ? (
        <div className="mt-3">
          <Alert tone="error" title="La plateforme a refusé le dernier échange">
            <p className="break-words font-mono text-xs">{connection.lastError}</p>
            <p className="mt-2">
              Tant que ce raccordement ne répond pas, les factures de cette entreprise resteront en
              file d&apos;attente sans partir.
            </p>
          </Alert>
        </div>
      ) : null}

      {mayManage ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={verifyConnection}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <Button type="submit" variant="secondary">
              Vérifier le raccordement
            </Button>
          </form>
          <form action={deactivateConnection}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <Button type="submit" variant="secondary">
              Désactiver
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}

/**
 * The last verdict, or its absence.
 *
 * "Jamais vérifié" is shown as a warning rather than as neutral text, because it is the state a
 * connection lands in after its credentials are edited — and an unverified connection is one whose
 * first sign of trouble would otherwise be an invoice that never leaves.
 */
function VerificationBadge({ connection }: { connection: PdpConnectionRecord }) {
  if (connection.lastError) {
    return <Badge tone="error">Échec de vérification</Badge>;
  }
  if (connection.lastVerifiedAt) {
    return <Badge tone="ok">Vérifié le {formatDateTime(connection.lastVerifiedAt)}</Badge>;
  }
  return <Badge tone="warn">Jamais vérifié</Badge>;
}

function NotConnectedBadge() {
  return <Badge tone="warn">Non raccordée</Badge>;
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: React.ReactNode }) {
  const styles = {
    ok: 'bg-signal-okBg text-signal-ok',
    warn: 'bg-signal-warnBg text-signal-warn',
    error: 'bg-signal-errorBg text-signal-error',
  }[tone];

  return (
    <span className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium ${styles}`}>{children}</span>
  );
}

/** An adapter this build no longer registers still has to be nameable on screen. */
function displayName(providers: readonly PdpProviderOption[], key: string): string {
  return providers.find((provider) => provider.key === key)?.displayName ?? key;
}
