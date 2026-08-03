'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, Field, TextInput } from '@/components/ui/Form';
import { NO_RESET_REQUEST } from '@/lib/form-state';
import { requestReset } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Envoi…' : 'Recevoir un lien'}
    </Button>
  );
}

export function ForgotForm() {
  const [state, formAction] = useActionState(requestReset, NO_RESET_REQUEST);

  /*
    The confirmation is deliberately the same whether or not the address has an account. Saying
    "no such account" here would turn this form into a way of asking which businesses use this
    cabinet — and that list is the product's most sensitive asset.
  */
  if (state.submitted) {
    return (
      <Alert tone="success" title="Vérifiez votre boîte de réception">
        <p>
          Si un compte existe pour cette adresse, un lien de réinitialisation vient d&apos;être
          envoyé. Il est valable deux heures et ne peut servir qu&apos;une fois.
        </p>
        <p className="mt-3">
          Rien reçu au bout de quelques minutes ? Regardez dans les indésirables, puis réessayez.
        </p>
        <p className="mt-3">
          <Link href="/connexion" className="font-semibold underline">
            Retour à la connexion
          </Link>
        </p>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field label="Adresse e-mail" name="email" required>
        <TextInput
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="vous@cabinet.fr"
        />
      </Field>

      <SubmitButton />
    </form>
  );
}
