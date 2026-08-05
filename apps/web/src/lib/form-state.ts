/**
 * Shapes and initial values for `useActionState` forms.
 *
 * Separate from the action modules because a `'use server'` file may only export async functions -
 * everything in it becomes a callable server endpoint, so a plain object export is rejected
 * outright rather than treated as a constant. Keeping the initial states here also means a client
 * component can import them without pulling a server module into its graph.
 */

/** A form whose only failure mode is one message. */
export interface FormState {
  readonly error: string | null;
}

export const NO_ERROR: FormState = { error: null };

/** Client-org creation: same shape, named separately so the two cannot be swapped by accident. */
export type ClientOrgFormState = FormState;

export const NO_CLIENT_ERROR: ClientOrgFormState = { error: null };

/**
 * Issuance can fail with a list as well as a message.
 *
 * A refused draft reports every problem at once - a missing buyer address *and* a missing
 * exemption reason - because fixing them one round trip at a time is the difference between one
 * correction and four.
 */
export interface IssueFormState {
  readonly error: string | null;
  readonly issues: readonly string[];
}

export const NO_ISSUE_ERROR: IssueFormState = { error: null, issues: [] };

/** Reception reports a result in place rather than redirecting; see `receiveInvoice`. */
export interface ReceiveFormState {
  readonly error: string | null;
  readonly result: {
    readonly invoiceId: string;
    readonly invoiceNumber: string;
    readonly clientOrgName: string;
    readonly supplierName: string | null;
    readonly conforme: boolean;
    readonly duplicate: boolean;
    readonly errorCount: number;
    readonly ruleIds: readonly string[];
    readonly filename: string;
  } | null;
}

export const NO_RECEIVE_STATE: ReceiveFormState = { error: null, result: null };

/** User management reports in place; the list beneath it is revalidated on success. */
export interface UserFormState {
  readonly error: string | null;
  readonly created: string | null;
  /** True when no password was set and an invitation link was issued instead. */
  readonly invited?: boolean;
  /** False when the invitation was issued but could not be delivered. */
  readonly invitationSent?: boolean;
}

export const NO_USER_STATE: UserFormState = { error: null, created: null };

/** Connecting a business to its platform; reports in place so the form keeps its context. */
export interface PdpConnectionFormState {
  readonly error: string | null;
  readonly saved: boolean;
}

export const NO_PDP_CONNECTION_STATE: PdpConnectionFormState = { error: null, saved: false };

/**
 * Queueing an invoice, or putting a parked transmission back in the queue.
 *
 * `alreadyQueued` is reported rather than smoothed over. Pressing "transmettre" twice is the
 * natural response to a screen that has not visibly changed, and the honest answer to the second
 * press is "it was already on its way" — not a second confirmation implying a second send.
 */
export interface TransmitFormState {
  readonly error: string | null;
  readonly queued: boolean;
  readonly alreadyQueued: boolean;
}

export const NO_TRANSMIT_STATE: TransmitFormState = {
  error: null,
  queued: false,
  alreadyQueued: false,
};

/** Password-reset request: always reports the same thing, whether or not the address exists. */
export interface ResetRequestState {
  readonly error: string | null;
  readonly submitted: boolean;
}

export const NO_RESET_REQUEST: ResetRequestState = { error: null, submitted: false };

/** Setting a password from an emailed link. */
export interface SetPasswordState {
  readonly error: string | null;
  /** True once the password is set, so the page can offer sign-in instead of the form. */
  readonly done: boolean;
}

export const NO_SET_PASSWORD: SetPasswordState = { error: null, done: false };
