import { IsBoolean, IsObject, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * Raccordement d'une entreprise cliente à sa plateforme.
 *
 * `secrets` is a free-form map because every platform asks for a different set - an API key here,
 * a client id and secret there, a certificate passphrase elsewhere - and the adapter is the only
 * thing that knows which. Validating the shape here would mean this file changing every time an
 * adapter is added, and being wrong about a platform nobody has integrated yet.
 *
 * What is *not* free-form is where it goes: the map is encrypted before it reaches the database
 * and never returned by any route. A caller can set credentials and can be told whether they
 * work; it cannot read them back.
 */
export class UpsertPdpConnectionDto {
  /** Adapter key. Checked against the registry, so an unknown platform is a 400 rather than a row. */
  @IsString()
  @MaxLength(64)
  provider!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string | null;

  @IsOptional()
  @IsUrl(
    { require_tld: false, protocols: ['http', 'https'] },
    { message: 'apiBaseUrl doit être une URL http(s) valide.' },
  )
  apiBaseUrl?: string | null;

  /** PEPPOL participant identifier, when the transport is PEPPOL eDelivery. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  peppolAddress?: string | null;

  /**
   * Credentials to encrypt and store.
   *
   * Omitting it on an update keeps whatever is already stored, so a user editing the label of a
   * connection does not have to re-enter a secret they cannot read back.
   */
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
