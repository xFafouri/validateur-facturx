'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button } from '@/components/ui/Form';
import { NO_WEBHOOK_STATE } from '@/lib/form-state';
import type { PdpConnectionRecord } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { createWebhookToken, revokeWebhookToken } from './actions';

function SubmitButton({ existing }: { existing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Génération…' : existing ? 'Régénérer le jeton' : 'Générer un jeton'}
    </Button>
  );
}

/** A value to copy out. Monospace and wrapped, because these are long and must survive a paste. */
function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-navy-500">{label}</p>
      <p className="mt-1 break-all rounded border border-navy-200 bg-white px-3 py-2 font-mono text-[12px] text-navy-900">
        {value}
      </p>
    </div>
  );
}

/**
 * Webhook configuration for one connection.
 *
 * The panel is deliberately modest about what a webhook is for. It only ever makes the next poll
 * happen sooner — polling on a timer stays the mechanism — so a connection with no webhook is
 * fully functional, just slower to notice things. Saying that here stops it reading as a missing
 * step somebody has to complete.
 */
export function WebhookPanel({ connection }: { connection: PdpConnectionRecord }) {
  const [state, formAction] = useActionState(createWebhookToken, NO_WEBHOOK_STATE);

  return (
    <div className="mt-4 border-t border-navy-50 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-navy-900">Webhook</h3>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-navy-500">
            Facultatif. Un webhook ne fait qu&apos;avancer la prochaine interrogation : les statuts
            et les factures entrantes sont relevés périodiquement de toute façon, et c&apos;est ce
            relevé qui fait foi. Sans webhook, tout fonctionne — simplement avec un peu de délai.
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-2.5 py-1 text-xs font-medium ${
            connection.hasWebhook ? 'bg-signal-okBg text-signal-ok' : 'bg-navy-50 text-navy-600'
          }`}
        >
          {connection.hasWebhook ? 'Configuré' : 'Non configuré'}
        </span>
      </div>

      {connection.hasWebhook ? (
        <p className="mt-2 text-xs text-navy-500">
          Dernier appel reçu : {formatDateTime(connection.lastWebhookAt)}
          {connection.lastWebhookAt === null
            ? " — la plateforme n'a encore jamais appelé. Vérifiez l'URL enregistrée chez elle."
            : ''}
        </p>
      ) : null}

      {state.error ? (
        <div className="mt-3">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}

      {/*
        The one moment this token is readable. It is stored as a hash, so there is no "show again"
        the API could honour, and the warning has to be unambiguous about that.
      */}
      {state.token && state.url ? (
        <div className="mt-3">
          <Alert tone="warn" title="Copiez ce jeton maintenant">
            <p>
              Il ne sera plus affiché : seule son empreinte est conservée. Enregistrez ces valeurs
              chez votre plateforme. Régénérer un jeton invalide immédiatement le précédent.
            </p>
            <Copyable label="URL à appeler (POST)" value={state.url} />
            <Copyable label={`En-tête ${state.headerName}`} value={state.token} />
            {/*
              A path with no origin means the deployment has not said where the API is publicly
              reachable. Saying so beats printing a URL the platform cannot resolve.
            */}
            {state.url.startsWith('/') ? (
              <p className="mt-3 text-xs">
                Cette URL est relative : renseignez <code>PDP_WEBHOOK_BASE_URL</code> avec
                l&apos;adresse publique de l&apos;API pour l&apos;obtenir complète, et préfixez-la
                d&apos;ici là.
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <form action={formAction}>
          <input type="hidden" name="connectionId" value={connection.id} />
          <SubmitButton existing={connection.hasWebhook} />
        </form>
        {connection.hasWebhook ? (
          <form action={revokeWebhookToken}>
            <input type="hidden" name="connectionId" value={connection.id} />
            <Button type="submit" variant="secondary">
              Révoquer
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
