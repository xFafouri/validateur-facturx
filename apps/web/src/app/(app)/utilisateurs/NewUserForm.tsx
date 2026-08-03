'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, Select, TextInput } from '@/components/ui/Form';
import { NO_USER_STATE } from '@/lib/form-state';
import type { ClientOrgSummary } from '@/lib/api';
import { createUser } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Envoi…' : 'Inviter'}
    </Button>
  );
}

const ROLE_HELP: Record<string, string> = {
  OWNER: 'Accès complet, y compris la gestion des utilisateurs.',
  ACCOUNTANT:
    'Accès à toutes les entreprises du compte : émission, réception, archives. Ne gère pas les utilisateurs.',
  CLIENT_USER:
    'Accès limité aux entreprises cochées ci-dessous. Peut consulter et déposer des factures reçues, mais pas en émettre.',
};

export function NewUserForm({
  clientOrgs,
  minPasswordLength,
}: {
  clientOrgs: readonly ClientOrgSummary[];
  minPasswordLength: number;
}) {
  const [state, formAction] = useActionState(createUser, NO_USER_STATE);
  const [role, setRole] = useState('ACCOUNTANT');

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.created && state.invited && state.invitationSent ? (
        <Alert tone="success" title="Invitation envoyée">
          <strong>{state.created}</strong> va recevoir un e-mail pour choisir son mot de passe. Le
          lien est valable sept jours. L&apos;accès n&apos;est actif qu&apos;une fois le lien
          utilisé.
        </Alert>
      ) : null}

      {/*
        The account exists and its link is valid — only delivery failed. Saying "created but not
        sent" is the honest report; claiming failure would leave an owner creating duplicates.
      */}
      {state.created && state.invited && state.invitationSent === false ? (
        <Alert tone="warn" title="Accès créé, invitation non envoyée">
          Le compte de <strong>{state.created}</strong> existe, mais l&apos;e-mail n&apos;a pas pu
          être envoyé. Vérifiez la configuration SMTP, puis renvoyez l&apos;invitation.
        </Alert>
      ) : null}

      {state.created && !state.invited ? (
        <Alert tone="success">
          L&apos;accès pour <strong>{state.created}</strong> a été créé avec le mot de passe que
          vous venez de saisir. Communiquez-le à la personne concernée — il n&apos;est plus
          consultable ensuite.
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Adresse e-mail" name="email" required>
          <TextInput name="email" type="email" required placeholder="collaborateur@cabinet.fr" />
        </Field>

        <Field label="Nom" name="name">
          <TextInput name="name" placeholder="Jean Dupont" />
        </Field>
      </div>

      <Field label="Rôle" name="role" required hint={ROLE_HELP[role]}>
        <Select name="role" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="ACCOUNTANT">Collaborateur</option>
          <option value="CLIENT_USER">Client</option>
          <option value="OWNER">Propriétaire</option>
        </Select>
      </Field>

      {/*
        Only the scoped role gets an assignment. A client user with nothing ticked sees nothing,
        which is the safe reading of an unfinished invitation - so the warning below is worth it.
      */}
      {role === 'CLIENT_USER' ? (
        <fieldset className="space-y-2 rounded border border-navy-100 bg-navy-50/50 p-4">
          <legend className="px-1 text-sm font-medium text-navy-900">
            Entreprises accessibles
          </legend>
          {clientOrgs.length === 0 ? (
            <p className="text-xs text-signal-warn">
              Aucune entreprise enregistrée : cet accès ne verra rien tant que vous ne lui en aurez
              pas attribué.
            </p>
          ) : (
            <>
              <p className="text-xs text-navy-600">
                Cet utilisateur ne verra que les entreprises cochées. Sans sélection, il ne verra
                rien.
              </p>
              {clientOrgs.map((org) => (
                <label key={org.id} className="flex items-center gap-2 text-sm text-navy-800">
                  <input
                    type="checkbox"
                    name="clientOrgIds"
                    value={org.id}
                    className="rounded border-navy-300"
                  />
                  {org.name}
                </label>
              ))}
            </>
          )}
        </fieldset>
      ) : null}

      {/*
        Deliberately optional and deliberately last. Left blank - the normal case - the user gets
        an emailed link and chooses their own password, so it is never known to anyone else.
      */}
      <details className="rounded border border-navy-100 bg-navy-50/50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-navy-900">
          Définir un mot de passe au lieu d&apos;envoyer une invitation
        </summary>
        <div className="mt-4">
          <Field
            label="Mot de passe initial"
            name="password"
            hint={`${minPasswordLength} caractères minimum. À n'utiliser que si l'envoi d'e-mails n'est pas configuré : vous devrez le communiquer vous-même, et il n'est pas récupérable ensuite.`}
          >
            <TextInput
              name="password"
              type="password"
              minLength={minPasswordLength}
              autoComplete="new-password"
            />
          </Field>
        </div>
      </details>

      <SubmitButton />
    </form>
  );
}
