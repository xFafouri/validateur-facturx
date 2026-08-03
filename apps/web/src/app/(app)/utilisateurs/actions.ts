'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { UserFormState } from '@/lib/form-state';

/**
 * Creates a login for the tenant.
 *
 * The owner sets the initial password and passes it on out of band. An invitation link would be
 * better and needs a mail transport, which does not exist yet — shipping a user list that cannot
 * actually create a user until then would leave the whole role model unusable.
 */
export async function createUser(
  _state: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const role = String(formData.get('role') ?? 'ACCOUNTANT');

  try {
    await api('/users', {
      method: 'POST',
      body: {
        email: String(formData.get('email') ?? '').trim(),
        name: String(formData.get('name') ?? '').trim() || undefined,
        role,
        password: String(formData.get('password') ?? ''),
        // Only meaningful for the scoped role; the API ignores it for the others.
        clientOrgIds: role === 'CLIENT_USER' ? formData.getAll('clientOrgIds').map(String) : [],
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message, created: null };
    throw error;
  }

  revalidatePath('/utilisateurs');
  return { error: null, created: String(formData.get('email') ?? '') };
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
