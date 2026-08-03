import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * A business the tenant invoices on behalf of.
 *
 * `tenantId` is absent on purpose: it comes from the session, so a caller cannot create a client
 * org inside someone else's account by naming one.
 *
 * The address fields are optional here but effectively required to issue: a seller with no
 * address fails EN 16931. Rejecting them at creation would stop a user from saving a client they
 * are still collecting details for, so the constraint is enforced where it actually applies -
 * at issuance, by the generator, with an explanation of which BT is missing.
 */
export class CreateClientOrgDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @Matches(/^\d{9}$/, { message: 'Le SIREN doit comporter 9 chiffres.' })
  siren!: string;

  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'Le SIRET doit comporter 14 chiffres.' })
  siret?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postcode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode doit être un code ISO 3166-1 alpha-2.' })
  countryCode?: string;

  /** See `profiles.ts` for why BASIC rather than EN 16931 is the default. */
  @IsOptional()
  @IsIn(['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'EXTENDED'])
  defaultProfile?: string;
}
