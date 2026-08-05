'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, Select, TextInput } from '@/components/ui/Form';
import { NO_PDP_CONNECTION_STATE } from '@/lib/form-state';
import type { PdpConnectionRecord, PdpProviderOption } from '@/lib/api';
import { saveConnection } from './actions';

function SubmitButton({ existing }: { existing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Enregistrement…' : existing ? 'Mettre à jour le raccordement' : 'Raccorder'}
    </Button>
  );
}

/**
 * The credential inputs for the selected platform.
 *
 * Three cases, because the adapter can say three different things — see `credentialFields` on
 * `PdpProvider`. The one that must not be collapsed into the others is the empty list: a platform
 * that authenticates by mutual TLS needs no secret, and showing an empty box would leave the user
 * hunting for a key that does not exist.
 */
function CredentialInputs({
  provider,
  hasCredentials,
}: {
  provider: PdpProviderOption | undefined;
  hasCredentials: boolean;
}) {
  const keep = hasCredentials ? ' Laissez vide pour conserver la valeur enregistrée.' : '';

  if (!provider) return null;

  if (provider.credentialFields === null) {
    return (
      <Field
        label="Identifiants"
        name="secretsText"
        hint={`Un identifiant par ligne, au format CLE=valeur. Cet adaptateur ne déclare pas ses champs : reportez-vous à la documentation de la plateforme pour les noms attendus.${keep}`}
      >
        <textarea
          id="secretsText"
          name="secretsText"
          rows={4}
          spellCheck={false}
          autoComplete="off"
          placeholder={'CLIENT_ID=…\nCLIENT_SECRET=…'}
          className="block w-full rounded border border-navy-200 bg-white px-3 py-2 font-mono text-[13px] text-navy-900 placeholder:text-navy-300 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200"
        />
      </Field>
    );
  }

  if (provider.credentialFields.length === 0) {
    return (
      <p className="rounded border border-navy-100 bg-navy-50/50 px-4 py-3 text-xs text-navy-600">
        Cette plateforme ne demande aucun identifiant.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {provider.credentialFields.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          name={`secret:${field.key}`}
          required={field.required && !hasCredentials}
          hint={`${field.hint ?? ''}${field.hint ? ' ' : ''}${keep}`.trim() || undefined}
        >
          <TextInput
            name={`secret:${field.key}`}
            /*
              A password input for every credential, including the ones that are only mildly
              secret. Nobody has to decide field by field which values are safe to render over a
              shoulder, and the browser stops offering to remember them.
            */
            type="password"
            autoComplete="off"
            spellCheck={false}
            required={field.required && !hasCredentials}
          />
        </Field>
      ))}
    </div>
  );
}

export function ConnectionForm({
  clientOrgId,
  providers,
  connection,
}: {
  clientOrgId: string;
  providers: readonly PdpProviderOption[];
  /** The connection being edited, or undefined when connecting this business for the first time. */
  connection?: PdpConnectionRecord;
}) {
  const [state, formAction] = useActionState(saveConnection, NO_PDP_CONNECTION_STATE);
  const [providerKey, setProviderKey] = useState(connection?.provider ?? providers[0]?.key ?? '');

  const selected = providers.find((candidate) => candidate.key === providerKey);
  // Only for the connection actually being edited: switching the picker to another platform means
  // a different set of credentials, none of which are stored yet.
  const hasCredentials = connection?.hasCredentials === true && connection.provider === providerKey;

  if (providers.length === 0) {
    return (
      <Alert tone="warn" title="Aucun adaptateur disponible">
        Cette installation n&apos;embarque aucun adaptateur de plateforme. Un raccordement ne peut
        pas être créé tant qu&apos;il n&apos;y en a pas au moins un.
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="clientOrgId" value={clientOrgId} />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.saved ? (
        <Alert tone="success" title="Raccordement enregistré">
          Vérifiez-le pour confirmer que la plateforme accepte ces identifiants avant de transmettre
          une facture.
        </Alert>
      ) : null}

      <Field label="Plateforme" name="provider" required>
        <Select
          name="provider"
          value={providerKey}
          onChange={(event) => setProviderKey(event.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.key} value={provider.key}>
              {provider.displayName}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Libellé"
          name="label"
          hint="Pour vous y retrouver quand plusieurs entreprises sont raccordées."
        >
          <TextInput name="label" defaultValue={connection?.label ?? ''} placeholder="Production" />
        </Field>

        <Field
          label="URL de l’API"
          name="apiBaseUrl"
          hint="Fournie par la plateforme. Laissez vide si l’adaptateur connaît déjà son adresse."
        >
          <TextInput
            name="apiBaseUrl"
            type="url"
            inputMode="url"
            defaultValue={connection?.apiBaseUrl ?? ''}
            placeholder="https://api.plateforme.fr"
          />
        </Field>
      </div>

      <Field
        label="Adresse PEPPOL"
        name="peppolAddress"
        hint="Identifiant de participant, si le transport passe par PEPPOL eDelivery."
      >
        <TextInput
          name="peppolAddress"
          defaultValue={connection?.peppolAddress ?? ''}
          placeholder="0009:44306184100005"
        />
      </Field>

      <CredentialInputs provider={selected} hasCredentials={hasCredentials} />

      <label className="flex items-center gap-2 text-sm text-navy-800">
        <input
          type="checkbox"
          name="active"
          defaultChecked={connection?.active ?? true}
          className="rounded border-navy-300"
        />
        Raccordement actif — les factures de cette entreprise partent par cette plateforme
      </label>

      <SubmitButton existing={connection !== undefined} />
    </form>
  );
}
