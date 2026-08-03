/**
 * Form primitives for the authenticated area.
 *
 * Small and unabstracted on purpose. The validator's result view already carries the visual
 * language; these exist so that a label, its input and its error message are wired together
 * correctly in one place rather than in each of a dozen forms - `aria-describedby` and
 * `aria-invalid` are the kind of thing that gets dropped when every form does it by hand.
 */

import type { ReactNode } from 'react';

export function Field({
  label,
  name,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children?: ReactNode;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-navy-900">
        {label}
        {required ? (
          <span className="ml-1 text-signal-error" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-2 text-xs font-normal text-navy-400">facultatif</span>
        )}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-navy-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-signal-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  'block w-full rounded border border-navy-200 bg-white px-3 py-2 text-[15px] text-navy-900 ' +
  'placeholder:text-navy-300 focus:border-navy-500 focus:outline-none focus:ring-2 focus:ring-navy-200 ' +
  'disabled:bg-navy-50 disabled:text-navy-400 aria-[invalid=true]:border-signal-error';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} id={props.id ?? props.name} className={INPUT_CLASS} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} id={props.id ?? props.name} className={INPUT_CLASS} />;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-60';
  const styles =
    variant === 'primary'
      ? 'bg-navy-800 text-white hover:bg-navy-900'
      : 'border border-navy-200 bg-white text-navy-800 hover:bg-navy-50';

  return <button {...props} className={`${base} ${styles} ${className}`} />;
}

/**
 * A message the user must read.
 *
 * `role="alert"` on the error tone only: a screen reader should interrupt for a failed submission,
 * not for a confirmation the user just caused and already expects.
 */
export function Alert({
  tone,
  title,
  children,
}: {
  tone: 'error' | 'success' | 'info' | 'warn';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    error: 'border-signal-error/30 bg-signal-errorBg text-signal-error',
    success: 'border-signal-ok/30 bg-signal-okBg text-signal-ok',
    info: 'border-signal-info/30 bg-signal-infoBg text-signal-info',
    warn: 'border-signal-warn/30 bg-signal-warnBg text-signal-warn',
  }[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={`rounded border px-4 py-3 text-sm ${styles}`}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
