'use client';

import { useCallback, useRef, useState } from 'react';
import type { AnalysisDto } from '@facturx/core';
import { ResultView } from './results/ResultView';

type Status = 'idle' | 'uploading' | 'done' | 'error';

const ACCEPTED = '.pdf,.xml,application/pdf,text/xml,application/xml';
const MAX_MB = 20;

export function Validator() {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<AnalysisDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const submit = useCallback(async (file: File) => {
    setStatus('uploading');
    setError(null);
    setResult(null);

    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Le fichier dépasse ${MAX_MB} Mo.`);
      setStatus('error');
      return;
    }

    const body = new FormData();
    body.append('fichier', file);

    try {
      const response = await fetch('/api/valider', { method: 'POST', body });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error?.message ?? "L'analyse a échoué.");
        setStatus('error');
        return;
      }

      setResult(payload as AnalysisDto);
      setStatus('done');
      // Move focus to the result so keyboard and screen-reader users are not left at the
      // dropzone wondering whether anything happened.
      requestAnimationFrame(() => {
        resultRef.current?.focus();
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch {
      setError(
        "La connexion au service d'analyse a échoué. Vérifiez votre connexion et réessayez.",
      );
      setStatus('error');
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void submit(file);
    },
    [submit],
  );

  const busy = status === 'uploading';

  return (
    <div className="w-full">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'rounded-xl border-2 border-dashed p-8 text-center transition-colors sm:p-10',
          dragging
            ? 'border-navy-400 bg-navy-50'
            : 'border-navy-200 bg-white/60 hover:border-navy-300',
          busy ? 'pointer-events-none opacity-70' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          id="fichier-facture"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void submit(file);
            // Reset so re-selecting the same file after a fix fires change again.
            event.target.value = '';
          }}
        />

        {busy ? (
          <div className="flex flex-col items-center gap-3 py-2" role="status" aria-live="polite">
            <svg
              className="h-8 w-8 animate-spin text-navy-500"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-90"
                fill="currentColor"
                d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z"
              />
            </svg>
            <p className="text-sm font-medium text-navy-800">Analyse en cours…</p>
            <p className="text-xs text-navy-500">
              Contrôle du schéma, des ~140 règles EN 16931 et des règles françaises.
            </p>
          </div>
        ) : (
          <>
            <svg
              className="mx-auto h-10 w-10 text-navy-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5V9m0 0L9 12m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-.53-8.97 5.25 5.25 0 0 1 10.29-1.53A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
              />
            </svg>

            <p className="mt-4 text-base font-semibold text-navy-900">Déposez votre facture ici</p>
            <p className="mt-1 text-sm text-navy-600">
              PDF Factur-X ou fichier XML (CII) — {MAX_MB} Mo maximum
            </p>

            <label
              htmlFor="fichier-facture"
              className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-700 focus-within:ring-2 focus-within:ring-navy-500 focus-within:ring-offset-2"
            >
              Choisir un fichier
            </label>

            <p className="mt-4 text-xs text-navy-500">
              Sans inscription. Votre facture n&apos;est ni enregistrée ni transmise à un tiers :
              elle est analysée puis immédiatement oubliée.
            </p>
          </>
        )}
      </div>

      {status === 'error' && error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-signal-error/30 bg-signal-errorBg p-4 text-sm text-signal-error"
        >
          <strong className="font-semibold">Analyse impossible.</strong> {error}
        </div>
      )}

      {status === 'done' && result && (
        <div ref={resultRef} tabIndex={-1} className="mt-8 scroll-mt-6 focus:outline-none">
          <ResultView
            result={result}
            onReset={() => {
              setStatus('idle');
              setResult(null);
              inputRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
