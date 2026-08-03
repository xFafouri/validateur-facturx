'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, TextInput } from '@/components/ui/Form';
import { signIn } from '../actions';
import { NO_ERROR } from '@/lib/form-state';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Connexion…' : 'Se connecter'}
    </Button>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signIn, NO_ERROR);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <input type="hidden" name="next" value={next} />

      <Field label="Adresse e-mail" name="email" required>
        <TextInput
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          aria-invalid={state.error ? true : undefined}
          placeholder="vous@cabinet.fr"
        />
      </Field>

      <Field label="Mot de passe" name="password" required>
        <TextInput
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
