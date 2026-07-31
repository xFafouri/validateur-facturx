import { Module } from '@nestjs/common';

/**
 * Phase 1: invoice creation, Factur-X generation, self-validation.
 *
 * Generation must reuse the totals logic in `@facturx/core` rather than recomputing amounts, so
 * that what we emit is checked by the same arithmetic that validates what we receive.
 */
@Module({})
export class InvoicingModule {}
