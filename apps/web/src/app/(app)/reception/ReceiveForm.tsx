'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button } from '@/components/ui/Form';
import { NO_RECEIVE_STATE } from '@/lib/form-state';
import { receiveInvoice } from './actions';

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Analyse en cours…' : 'Déposer la facture'}
    </Button>
  );
}

export function ReceiveForm() {
  const [state, formAction] = useActionState(receiveInvoice, NO_RECEIVE_STATE);
  const [filename, setFilename] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-navy-200 bg-white px-6 py-8 text-center">
          <label htmlFor="facture" className="block cursor-pointer">
            <span className="text-sm font-medium text-navy-900">
              Choisissez un PDF Factur-X ou un XML CII
            </span>
            <span className="mt-1 block text-xs text-navy-500">
              La facture est analysée, rattachée à la bonne entreprise, puis archivée.
            </span>
          </label>

          <input
            ref={inputRef}
            id="facture"
            name="facture"
            type="file"
            required
            accept=".pdf,.xml,application/pdf,application/xml,text/xml"
            onChange={(event) => setFilename(event.target.files?.[0]?.name ?? null)}
            className="mx-auto mt-4 block w-full max-w-sm text-sm text-navy-700 file:mr-3 file:rounded file:border-0 file:bg-navy-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-navy-900"
          />

          {filename ? <p className="mt-3 truncate text-xs text-navy-600">{filename}</p> : null}
        </div>

        <div className="flex items-center gap-3">
          <SubmitButton disabled={filename === null} />
          {filename ? (
            <button
              type="button"
              onClick={() => {
                setFilename(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
              className="text-sm text-navy-600 underline"
            >
              Annuler
            </button>
          ) : null}
        </div>
      </form>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      {state.result ? <Outcome result={state.result} /> : null}
    </div>
  );
}

/**
 * What happened to the document.
 *
 * A non-conforming invoice is reported as **received**, with a warning about its contents - not as
 * a failure. It is in the archive either way, and telling an accountant "échec" for a supplier's
 * bad invoice would suggest there is nothing to find, when the opposite is true.
 */
function Outcome({ result }: { result: NonNullable<typeof NO_RECEIVE_STATE.result> }) {
  const detail = (
    <>
      <p>
        {result.duplicate ? 'Déjà reçue : ' : ''}
        Facture <strong>{result.invoiceNumber}</strong>
        {result.supplierName ? (
          <>
            {' '}
            de <strong>{result.supplierName}</strong>
          </>
        ) : null}
        , rattachée à {result.clientOrgName}.
      </p>
      {result.duplicate ? (
        <p className="mt-2">
          Ce document exact était déjà dans vos archives ; rien n&apos;a été enregistré une seconde
          fois.
        </p>
      ) : null}
      <p className="mt-3">
        <Link href={`/factures/${result.invoiceId}`} className="font-semibold underline">
          Ouvrir la facture
        </Link>
      </p>
    </>
  );

  if (result.conforme) {
    return (
      <Alert tone="success" title="Facture reçue et conforme">
        {detail}
      </Alert>
    );
  }

  return (
    <Alert tone="warn" title="Facture reçue, mais non conforme">
      {detail}
      <p className="mt-3">
        {result.errorCount} erreur{result.errorCount > 1 ? 's' : ''} détectée
        {result.errorCount > 1 ? 's' : ''}
        {result.ruleIds.length > 0 ? ` (${result.ruleIds.slice(0, 4).join(', ')})` : ''}. Elle est
        archivée telle qu&apos;elle a été reçue — c&apos;est la pièce qui prouve ce que votre
        fournisseur a envoyé. Vous pouvez la lui signaler pour rectification.
      </p>
    </Alert>
  );
}
