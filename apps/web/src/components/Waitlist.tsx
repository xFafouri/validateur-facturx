'use client';

import { useState } from 'react';

/**
 * Waitlist signup shown after a validation result.
 *
 * Phase 0's only conversion mechanism. The framing is deliberate: the validator has already
 * delivered its full value for free by the time this appears, so this asks rather than gates.
 * Withholding the verdict behind an email would contradict the "sans inscription" promise the
 * landing page makes, and would be the exact bait-and-switch the tool is positioned against.
 *
 * The persona question is worth the extra field: whether the early signups are accountants or
 * one-person businesses should decide what gets built after Phase 1, and it is much cheaper to
 * ask now than to survey later.
 */

const CONSENT_TEXT =
  "J'accepte d'être recontacté par e-mail au sujet de la facturation électronique et de la disponibilité de cet outil. Mon adresse ne sera ni revendue ni transmise à un tiers.";

const PROFILES = [
  { value: 'TPE', label: 'Je facture pour ma propre entreprise' },
  { value: 'ACCOUNTANT', label: 'Je suis comptable / cabinet comptable' },
  { value: 'SOFTWARE_VENDOR', label: "J'édite un logiciel métier" },
  { value: 'OTHER', label: 'Autre' },
] as const;

type State = 'idle' | 'sending' | 'done' | 'error';

export function Waitlist({ verdict }: { verdict: string }) {
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<string>('TPE');
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState('sending');
    setMessage(null);

    try {
      const response = await fetch('/api/inscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          profile,
          consent,
          consentText: CONSENT_TEXT,
          source: `validator-result-${verdict}`,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setMessage(payload?.error?.message ?? "L'inscription a échoué.");
        setState('error');
        return;
      }

      setMessage(payload?.message ?? 'Inscription enregistrée.');
      setState('done');
    } catch {
      setMessage("L'inscription a échoué. Vérifiez votre connexion.");
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div
        role="status"
        className="rounded-lg border border-signal-ok/30 bg-signal-okBg p-4 text-sm text-navy-800"
      >
        <strong className="font-semibold text-signal-ok">C&apos;est noté.</strong> {message} Vous
        pouvez vous désinscrire à tout moment en répondant à l&apos;un de nos e-mails.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-navy-200 bg-navy-50/60 p-4">
      <h3 className="text-sm font-semibold text-navy-900">
        Bientôt : générer vos factures conformes, pas seulement les vérifier
      </h3>
      <p className="mt-1 text-sm text-navy-600">
        Nous préparons l&apos;émission de factures Factur-X et un tableau de bord pour les cabinets
        gérant plusieurs clients. Laissez votre e-mail pour être prévenu.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="waitlist-email" className="block text-xs font-medium text-navy-700">
            Adresse e-mail
          </label>
          <input
            id="waitlist-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="vous@entreprise.fr"
            className="mt-1 w-full rounded-lg border border-navy-300 px-3 py-2 text-sm text-navy-900 placeholder:text-navy-400"
          />
        </div>

        <div>
          <label htmlFor="waitlist-profile" className="block text-xs font-medium text-navy-700">
            Vous êtes
          </label>
          <select
            id="waitlist-profile"
            value={profile}
            onChange={(event) => setProfile(event.target.value)}
            className="mt-1 w-full rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm text-navy-900"
          >
            {PROFILES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-navy-600">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-navy-300"
        />
        {/* The wording here is stored verbatim with the signup: proving consent means proving
            what was consented to, and this text will change over time. */}
        <span>{CONSENT_TEXT}</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:opacity-60"
        >
          {state === 'sending' ? 'Envoi…' : 'Me prévenir'}
        </button>
        <span className="text-xs text-navy-500">
          Aucune donnée de votre facture n&apos;est enregistrée.
        </span>
      </div>

      {state === 'error' && message && (
        <p role="alert" className="mt-3 text-sm text-signal-error">
          {message}
        </p>
      )}
    </form>
  );
}
