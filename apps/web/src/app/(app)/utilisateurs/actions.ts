'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { UserFormState } from '@/lib/form-state';

/**
 * Creates a login for the tenant.
 *
 * The user is emailed a link to choose their own password. No password is set here and none is
 * shown to the owner, so it is never known to anyone but its owner. The fallback — an owner
 * setting one directly — stays available for a deployment with no mail relay.
 */
export async function createUser(
  _state: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const role = String(formData.get('role') ?? 'ACCOUNTANT');
  const password = String(formData.get('password') ?? '');

  let result: { invited: boolean; invitationSent: boolean };
  try {
    result = await api('/users', {
      method: 'POST',
      body: {
        email: String(formData.get('email') ?? '').trim(),
        name: String(formData.get('name') ?? '').trim() || undefined,
        role,
        // Omitted entirely when blank, which is what makes it an invitation rather than a
        // hand-over. Sending an empty string would fail the minimum-length check instead.
        ...(password === '' ? {} : { password }),
        // Only meaningful for the scoped role; the API ignores it for the others.
        clientOrgIds: role === 'CLIENT_USER' ? formData.getAll('clientOrgIds').map(String) : [],
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, created: null };
    throw error;
  }

  revalidatePath('/utilisateurs');
  return {
    error: null,
    created: String(formData.get('email') ?? ''),
    invited: result.invited,
    invitationSent: result.invitationSent,
  };
}

/** Enables or disables a login. Disabling ends the user's sessions immediately. */
export async function setUserDisabled(formData: FormData): Promise<void> {
  const id = String(formData.get('userId') ?? '');
  const disabled = String(formData.get('disabled') ?? '') === 'true';

  await api(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: { disabled } }).catch(
    (error: unknown) => {
      // A refusal here is a rule the user needs to see, not a crash. Surfaced through the page's
      // own error boundary rather than swallowed.
      if (error instanceof ApiError) throw new Error(error.message);
      throw error;
    },
  );

  revalidatePath('/utilisateurs');
}
