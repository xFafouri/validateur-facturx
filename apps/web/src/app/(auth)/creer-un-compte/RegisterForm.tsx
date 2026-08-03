'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, TextInput } from '@/components/ui/Form';
import { register } from '../actions';
import { NO_ERROR } from '@/lib/form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Création du compte…' : 'Créer le compte'}
    </Button>
  );
}

export function RegisterForm({ minPasswordLength }: { minPasswordLength: number }) {
  const [state, formAction] = useActionState(register, NO_ERROR);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field
        label="Nom du compte"
        name="tenantName"
        required
        hint="Votre cabinet ou votre entreprise. Vos entreprises clientes seront ajoutées ensuite."
      >
        <TextInput name="tenantName" required autoFocus placeholder="Cabinet Durand & Associés" />
      </Field>

      <Field label="Votre nom" name="name">
        <TextInput name="name" autoComplete="name" placeholder="Marie Durand" />
      </Field>

      <Field label="Adresse e-mail" name="email" required>
        <TextInput
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="vous@cabinet.fr"
        />
      </Field>

      <Field
        label="Mot de passe"
        name="password"
        required
        hint={`${minPasswordLength} caractères minimum. Une phrase dont vous vous souvenez vaut mieux qu'un mot court et compliqué.`}
      >
        <TextInput
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={minPasswordLength}
        />
      </Field>

      <Field label="Confirmez le mot de passe" name="passwordConfirm" required>
        <TextInput
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={minPasswordLength}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
