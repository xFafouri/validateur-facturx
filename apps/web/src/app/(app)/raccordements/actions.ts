'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError, type PdpConnectionRecord } from '@/lib/api';
import type { PdpConnectionFormState } from '@/lib/form-state';
import { parseSecretLines, SecretSyntaxError } from '@/lib/secrets';

/** Empty string to undefined, so an untouched optional input is absent rather than blank. */
function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim();
  return text === '' ? undefined : text;
}

/**
 * Collects the secrets the user typed, in whichever form the platform asked for them.
 *
 * Returning `undefined` rather than `{}` when nothing was entered is the important part: the API
 * leaves stored credentials alone when `secrets` is absent, and replaces them when it is present.
 * Sending an empty map from a user who only came to rename a connection would wipe the secret
 * they cannot re-enter, because they can no longer read it.
 */
function collectSecrets(formData: FormData): Record<string, string> | undefined {
  const declared: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith('secret:')) continue;
    const entered = String(value);
    // A blank declared field means "leave this one as it is", for the same reason as above.
    if (entered === '') continue;
    declared[name.slice('secret:'.length)] = entered;
  }

  const freeForm = parseSecretLines(String(formData.get('secretsText') ?? ''));
  const merged = { ...declared, ...freeForm };

  return Object.keys(merged).length === 0 ? undefined : merged;
}

/**
 * Creates or replaces a business's platform connection.
 *
 * `PUT` on the business rather than `POST` to a collection, mirroring the API: a business has one
 * active connection, so there is nothing to add to, only something to set.
 */
export async function saveConnection(
  _state: PdpConnectionFormState,
  formData: FormData,
): Promise<PdpConnectionFormState> {
  const clientOrgId = String(formData.get('clientOrgId') ?? '');
  if (clientOrgId === '') return { error: 'Entreprise cliente manquante.', saved: false };

  let secrets: Record<string, string> | undefined;
  try {
    secrets = collectSecrets(formData);
  } catch (error) {
    // A typo in the credential box, reported before anything is sent — the user still has what
    // they typed on screen and can fix the line the message names.
    if (error instanceof SecretSyntaxError) return { error: error.message, saved: false };
    throw error;
  }

  try {
    await api<PdpConnectionRecord>(`/pdp/connections/${encodeURIComponent(clientOrgId)}`, {
      method: 'PUT',
      body: {
        provider: String(formData.get('provider') ?? '').trim(),
        label: optional(formData.get('label')) ?? null,
        apiBaseUrl: optional(formData.get('apiBaseUrl')) ?? null,
        peppolAddress: optional(formData.get('peppolAddress')) ?? null,
        ...(secrets ? { secrets } : {}),
        active: formData.get('active') !== null,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, saved: false };
    throw error;
  }

  revalidatePath('/raccordements');
  return { error: null, saved: true };
}

/**
 * Checks a connection against the platform.
 *
 * The verdict is stored by the API rather than returned to the page, so revalidating is enough to
 * show it — and it stays on screen after a reload instead of vanishing with the response.
 */
export async function verifyConnection(formData: FormData): Promise<void> {
  const id = String(formData.get('connectionId') ?? '');

  await api(`/pdp/connections/${encodeURIComponent(id)}/verify`, { method: 'POST' }).catch(
    (error: unknown) => {
      // A refused *verification* is a stored result, not a thrown error; reaching here means the
      // request itself failed, which the user needs to see rather than have swallowed.
      if (error instanceof ApiError) throw new Error(error.message);
      throw error;
    },
  );

  revalidatePath('/raccordements');
}

/** Deactivates a connection. Never deletes: its transmissions are evidence and must survive. */
export async function deactivateConnection(formData: FormData): Promise<void> {
  const id = String(formData.get('connectionId') ?? '');

  await api(`/pdp/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
    (error: unknown) => {
      if (error instanceof ApiError) throw new Error(error.message);
      throw error;
    },
  );

  revalidatePath('/raccordements');
}
