import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const ROLES = ['OWNER', 'ACCOUNTANT', 'CLIENT_USER'] as const;

export class CreateUserDto {
  @IsEmail({}, { message: "L'adresse e-mail n'est pas valide." })
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @IsIn(ROLES, { message: 'Rôle inconnu.' })
  role!: (typeof ROLES)[number];

  /**
   * Initial password.
   *
   * Set by the owner and handed over out of band, because there is no mail transport yet. The
   * alternative - an invitation link - needs email, and shipping a user list that cannot create a
   * user until then would leave roles unusable.
   */
  @IsString()
  @MinLength(12, { message: 'Le mot de passe doit contenir au moins 12 caractères.' })
  @MaxLength(512)
  password!: string;

  /** Which client businesses a CLIENT_USER may reach. Ignored for the unscoped roles. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  clientOrgIds?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn(ROLES, { message: 'Rôle inconnu.' })
  role?: (typeof ROLES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  clientOrgIds?: string[];

  /** Locks the account out without deleting it; the audit trail keeps referencing the user. */
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
