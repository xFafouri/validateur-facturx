/**
 * The wire shape of an issuance request.
 *
 * Two things are deliberately absent, and both absences are load-bearing:
 *
 *  - **No seller.** The issuing party is read from the client org, so a caller cannot invoice as
 *    a business it does not belong to whatever it puts in the body.
 *  - **No totals.** Every monetary total is derived from the lines. A total that cannot be
 *    supplied cannot disagree with the lines, which is the whole of BR-CO-10.
 *
 * Amounts are strings all the way in. `@IsNumber()` here would parse to IEEE-754 and hand a float
 * to code that exists to avoid one, one field before it reaches `Decimal`.
 */

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DRAFT_TYPE_CODES, VAT_CATEGORIES } from '@facturx/core';

/** `YYYY-MM-DD`. `IsISO8601` alone would also accept a full timestamp, which is not a BT-2. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Signed decimal, up to four places - the scale `money.ts` carries. */
const DECIMAL = /^-?\d{1,15}(\.\d{1,4})?$/;

export class DraftAddressDto {
  @IsString()
  @MaxLength(200)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string | null;

  @IsString()
  @MaxLength(20)
  postcode!: string;

  @IsString()
  @MaxLength(120)
  city!: string;

  @Matches(/^[A-Z]{2}$/, { message: 'countryCode doit être un code ISO 3166-1 alpha-2.' })
  countryCode!: string;
}

export class DraftPartyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Matches(/^\d{14}$/, { message: 'Le SIRET doit comporter 14 chiffres.' })
  siret?: string | null;

  @IsOptional()
  @Matches(/^\d{9}$/, { message: 'Le SIREN doit comporter 9 chiffres.' })
  siren?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatId?: string | null;

  @ValidateNested()
  @Type(() => DraftAddressDto)
  address!: DraftAddressDto;
}

export class DraftLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @Matches(DECIMAL, { message: 'quantity doit être un nombre décimal (4 décimales au plus).' })
  quantity!: string;

  @Matches(/^[A-Z0-9]{2,3}$/, { message: 'unitCode doit être un code UN/ECE Rec 20.' })
  unitCode!: string;

  @Matches(DECIMAL, { message: 'unitPrice doit être un nombre décimal (4 décimales au plus).' })
  unitPrice!: string;

  @IsIn(VAT_CATEGORIES as readonly string[])
  vatCategory!: (typeof VAT_CATEGORIES)[number];

  @Matches(DECIMAL, { message: 'vatRatePercent doit être un nombre décimal.' })
  vatRatePercent!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exemptionReason?: string | null;
}

export class IssueInvoiceDto {
  /** The business issuing. Checked against the caller's tenant before anything is generated. */
  @IsString()
  @MinLength(1)
  clientOrgId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  invoiceNumber!: string;

  @IsOptional()
  @IsIn(DRAFT_TYPE_CODES as readonly string[])
  typeCode?: (typeof DRAFT_TYPE_CODES)[number];

  @IsISO8601()
  @Matches(DATE_ONLY, { message: 'issueDate doit être au format AAAA-MM-JJ.' })
  issueDate!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueDate doit être au format AAAA-MM-JJ.' })
  dueDate?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'deliveryDate doit être au format AAAA-MM-JJ.' })
  deliveryDate?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  deliveryCountryCode?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency doit être un code ISO 4217.' })
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  buyerReference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  purchaseOrderReference?: string | null;

  @ValidateNested()
  @Type(() => DraftPartyDto)
  buyer!: DraftPartyDto;

  /**
   * Bounded because generation is expensive - a PDF/A-3 render plus a Schematron round trip - and
   * an unbounded array is a way to spend a lot of someone else's CPU with one request.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DraftLineDto)
  lines!: DraftLineDto[];

  @IsOptional()
  @Matches(/^\d{2}$/, { message: 'paymentMeansCode doit être un code UNTDID 4461.' })
  paymentMeansCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  paymentTerms?: string | null;

  @IsOptional()
  @Matches(DECIMAL, { message: 'prepaidAmount doit être un nombre décimal.' })
  prepaidAmount?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  notes?: string[];
}
