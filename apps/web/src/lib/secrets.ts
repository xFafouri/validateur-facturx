/**
 * Reading credentials typed into the free-form box.
 *
 * An adapter that declares its `credentialFields` gets a labelled input per field and never comes
 * through here. This is the fallback for one that has not: rather than leave such a platform
 * unconfigurable, the screen offers a `CLE=valeur` box, one per line, in the shape people already
 * know from `.env` files.
 *
 * It is deliberately strict. A line that does not parse is *refused*, not skipped — a silently
 * dropped credential is a connection that fails later, at transmission time, with an
 * authentication error nobody connects back to a typo made days earlier.
 */

export class SecretSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretSyntaxError';
  }
}

/** Strips one matching pair of surrounding quotes, since `.env` habits bring them along. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parses `CLE=valeur` lines into the map the API encrypts.
 *
 * Blank lines and `#` comments are ignored. Everything after the *first* `=` is the value, so a
 * secret containing `=` — which base64 padding routinely does — survives intact.
 *
 * @throws SecretSyntaxError on a line with no `=`, an empty key, or a duplicate key.
 */
export function parseSecretLines(text: string): Record<string, string> {
  const secrets: Record<string, string> = {};

  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) {
      throw new SecretSyntaxError(
        `Ligne ${index + 1} : « ${line} » n'est pas au format CLE=valeur.`,
      );
    }

    const key = line.slice(0, separator).trim();
    if (key === '') {
      throw new SecretSyntaxError(`Ligne ${index + 1} : la clé est vide.`);
    }
    // Refused rather than last-one-wins. Two values for one key means the user is unsure which is
    // right, and guessing on their behalf stores a secret they did not choose.
    if (Object.prototype.hasOwnProperty.call(secrets, key)) {
      throw new SecretSyntaxError(`Ligne ${index + 1} : la clé « ${key} » apparaît deux fois.`);
    }

    // An empty value is allowed through: a platform may legitimately want a blank optional field,
    // and the alternative is refusing something the user typed on purpose.
    secrets[key] = unquote(line.slice(separator + 1).trim());
  }

  return secrets;
}
