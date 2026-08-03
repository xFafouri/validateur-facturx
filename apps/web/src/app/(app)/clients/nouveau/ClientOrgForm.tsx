'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, TextInput } from '@/components/ui/Form';
import { createClientOrg } from '../actions';
import { NO_CLIENT_ERROR } from '@/lib/form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Enregistrement…' : "Enregistrer l'entreprise"}
    </Button>
  );
}

export function ClientOrgForm() {
  const [state, formAction] = useActionState(createClientOrg, NO_CLIENT_ERROR);

  /**
   * The SIRET contains the SIREN. Filling the SIREN from it saves retyping nine digits that must
   * match exactly - the API rejects the pair when they disagree, and the commonest way to make
   * them disagree is to type both by hand.
   */
  const [siren, setSiren] = useState('');

  return (
    <form action={formAction} className="space-y-6">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field label="Raison sociale" name="name" required>
        <TextInput name="name" required autoFocus placeholder="Plomberie Diderot SARL" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="SIRET"
          name="siret"
          hint="14 chiffres. Sert aussi d'adresse de routage dans l'Annuaire (schéma 0009)."
        >
          <TextInput
            name="siret"
            inputMode="numeric"
            placeholder="443 061 841 00005"
            onChange={(event) => {
              const value = event.target.value.replace(/\D/g, '');
              if (value.length >= 9) setSiren(value.slice(0, 9));
            }}
          />
        </Field>

        <Field label="SIREN" name="siren" required hint="9 chiffres. Rempli à partir du SIRET.">
          <TextInput
            name="siren"
            required
            inputMode="numeric"
            placeholder="443 061 841"
            value={siren}
            onChange={(event) => setSiren(event.target.value.replace(/\D/g, '').slice(0, 9))}
          />
        </Field>
      </div>

      <Field
        label="Numéro de TVA intracommunautaire"
        name="vatNumber"
        hint="Déduit du SIREN s'il est omis."
      >
        <TextInput name="vatNumber" placeholder="FR64443061841" />
      </Field>

      <fieldset className="space-y-5 rounded border border-navy-100 bg-navy-50/50 p-4">
        <legend className="px-1 text-sm font-medium text-navy-900">Adresse du siège</legend>
        <p className="text-xs leading-relaxed text-navy-600">
          Reprise telle quelle sur chaque facture émise. Une facture sans adresse de vendeur est
          rejetée par la norme EN 16931, donc ces champs sont exigés au moment d&apos;émettre.
        </p>

        <Field label="Adresse" name="addressLine1">
          <TextInput name="addressLine1" placeholder="12 rue de la République" />
        </Field>

        <Field label="Complément d'adresse" name="addressLine2">
          <TextInput name="addressLine2" placeholder="Bâtiment B" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Code postal" name="postcode">
            <TextInput name="postcode" inputMode="numeric" placeholder="69002" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Ville" name="city">
              <TextInput name="city" placeholder="Lyon" />
            </Field>
          </div>
        </div>
      </fieldset>

      <div className="flex gap-3">
        <SubmitButton />
      </div>
    </form>
  );
}
