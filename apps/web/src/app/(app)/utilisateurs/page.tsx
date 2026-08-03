import type { Metadata } from 'next';
import { MIN_PASSWORD_LENGTH, ROLE_LABELS, can } from '@facturx/auth';
import { api, ApiError, type ClientOrgSummary, type TenantUser } from '@/lib/api';
import { Alert } from '@/components/ui/Form';
import { formatDate } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { NewUserForm } from './NewUserForm';
import { setUserDisabled } from './actions';

export const metadata: Metadata = { title: 'Utilisateurs' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const actor = await requireUser();

  // Checked here as well as by the API. The API is what actually enforces it; this is so a
  // collaborator following a stale link gets an explanation rather than a raw 403 page.
  if (!can(actor.role, 'user:manage')) {
    return (
      <Alert tone="error" title="Accès réservé">
        La gestion des utilisateurs est réservée au propriétaire du compte.
      </Alert>
    );
  }

  let users: TenantUser[];
  let clientOrgs: ClientOrgSummary[];
  try {
    [users, clientOrgs] = await Promise.all([
      api<TenantUser[]>('/users'),
      api<ClientOrgSummary[]>('/client-orgs'),
    ]);
  } catch (error) {
    return (
      <Alert tone="error" title="Impossible de charger les utilisateurs">
        {error instanceof ApiError ? error.message : 'Le service est injoignable.'}
      </Alert>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Utilisateurs</h1>
        <p className="mt-1 text-sm text-navy-600">
          Qui peut accéder à ce compte, et à quelles entreprises.
        </p>
      </div>

      <section className="overflow-x-auto rounded-lg border border-navy-100 bg-white">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">Utilisateurs du compte</caption>
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-navy-500">
              <th scope="col" className="px-4 py-2.5 font-medium">
                Utilisateur
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Rôle
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Entreprises
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Dernière connexion
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Accès
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-navy-50 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-navy-900">{user.name ?? user.email}</div>
                  {user.name ? <div className="text-xs text-navy-500">{user.email}</div> : null}
                </td>
                <td className="px-4 py-3 text-navy-700">{ROLE_LABELS[user.role]}</td>
                <td className="px-4 py-3 text-navy-700">
                  {user.role === 'CLIENT_USER' ? (
                    user.scopedClientOrgs.length === 0 ? (
                      // Not a neutral blank: this user can currently see nothing at all.
                      <span className="text-signal-warn">Aucune — ne voit rien</span>
                    ) : (
                      user.scopedClientOrgs.map((org) => org.name).join(', ')
                    )
                  ) : (
                    <span className="text-navy-400">Toutes</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-navy-600">
                  {user.lastLoginAt ? formatDate(user.lastLoginAt.slice(0, 10), true) : 'Jamais'}
                </td>
                <td className="px-4 py-3 text-right">
                  {user.disabledAt ? (
                    <span className="mr-3 rounded bg-signal-errorBg px-2 py-0.5 text-xs font-medium text-signal-error">
                      Désactivé
                    </span>
                  ) : null}
                  {user.isSelf ? (
                    <span className="text-xs text-navy-400">vous</span>
                  ) : (
                    <form action={setUserDisabled} className="inline">
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="hidden"
                        name="disabled"
                        value={user.disabledAt ? 'false' : 'true'}
                      />
                      <button type="submit" className="text-xs text-navy-700 underline">
                        {user.disabledAt ? 'Réactiver' : 'Désactiver'}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-navy-900">Créer un accès</h2>
        <div className="rounded-lg border border-navy-100 bg-white p-6">
          <NewUserForm clientOrgs={clientOrgs} minPasswordLength={MIN_PASSWORD_LENGTH} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-navy-500">
          Désactiver un accès met fin immédiatement à ses sessions en cours. Le compte est conservé
          plutôt que supprimé : le journal d&apos;audit référence ses actions passées, et un journal
          dont les acteurs disparaissent n&apos;est plus un journal.
        </p>
      </section>
    </div>
  );
}
