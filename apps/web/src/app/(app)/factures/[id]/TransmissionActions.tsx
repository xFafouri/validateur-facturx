'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button } from '@/components/ui/Form';
import { NO_TRANSMIT_STATE, type TransmitFormState } from '@/lib/form-state';
import { retryTransmission, transmitInvoice } from './actions';

function SubmitButton({
  idle,
  busy,
  variant,
}: {
  idle: string;
  busy: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

/**
 * A refusal, made actionable where we can.
 *
 * The 409 for "this business is not connected to any platform" is the one users will actually hit,
 * and it is fixed on another screen — so it gets a link there rather than only a sentence. The
 * match is on the API's own wording; a miss costs nothing but the link.
 */
function TransmitError({ message }: { message: string }) {
  const notConnected = message.includes("n'est raccordée à aucune plateforme");

  return (
    <Alert tone="error" title="La facture n’a pas pu être mise en file">
      <p>{message}</p>
      {notConnected ? (
        <p className="mt-2">
          <Link href="/raccordements" className="font-semibold underline">
            Raccorder cette entreprise à une plateforme
          </Link>
        </p>
      ) : null}
    </Alert>
  );
}

function Outcome({ state }: { state: TransmitFormState }) {
  if (state.error) return <TransmitError message={state.error} />;
  if (!state.queued) return null;

  return (
    <Alert tone="success" title={state.alreadyQueued ? 'Déjà en file' : 'Mise en file d’attente'}>
      {state.alreadyQueued
        ? "Cette facture était déjà en attente de transmission ; rien n'a été envoyé une seconde fois."
        : 'La facture part au prochain passage du service de transmission. Son avancement apparaît dans le suivi ci-dessous.'}
    </Alert>
  );
}

export function TransmitForm({ invoiceId }: { invoiceId: string }) {
  const [state, formAction] = useActionState(transmitInvoice, NO_TRANSMIT_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Outcome state={state} />
      <SubmitButton idle="Transmettre à la plateforme" busy="Mise en file…" />
    </form>
  );
}

export function RetryForm({
  invoiceId,
  transmissionId,
}: {
  invoiceId: string;
  transmissionId: string;
}) {
  const [state, formAction] = useActionState(retryTransmission, NO_TRANSMIT_STATE);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="transmissionId" value={transmissionId} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.queued ? (
        <Alert tone="success">
          Remise en file. Le dépôt conserve sa clé d&apos;idempotence : la plateforme reconnaîtra un
          renvoi, pas une seconde facture.
        </Alert>
      ) : null}
      <SubmitButton idle="Réessayer" busy="Remise en file…" variant="secondary" />
    </form>
  );
}
