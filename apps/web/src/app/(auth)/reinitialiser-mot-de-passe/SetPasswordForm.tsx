'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, TextInput } from '@/components/ui/Form';
import { NO_SET_PASSWORD } from '@/lib/form-state';
import { setPassword } from './actions';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Enregistrement…' : label}
    </Button>
  );
}

export function SetPasswordForm({
  token,
  purpose,
  minPasswordLength,
}: {
  token: string;
  purpose: 'PASSWORD_RESET' | 'INVITATION';
  minPasswordLength: number;
}) {
  const [state, formAction] = useActionState(setPassword, NO_SET_PASSWORD);

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? (
        <Alert tone="error">
          <p>{state.error}</p>
          <p className="mt-2">
            <Link href="/mot-de-passe-oublie" className="font-semibold underline">
              Demander un nouveau lien
            </Link>
          </p>
        </Alert>
      ) : null}

      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="purpose" value={purpose} />

      <Field
        label="Nouveau mot de passe"
        name="password"
        required
        hint={`${minPasswordLength} caractères minimum. Une phrase dont vous vous souvenez vaut mieux qu'un mot court et compliqué.`}
      >
        <TextInput
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
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

      <SubmitButton
        label={purpose === 'INVITATION' ? 'Activer mon accès' : 'Changer le mot de passe'}
      />
    </form>
  );
}
