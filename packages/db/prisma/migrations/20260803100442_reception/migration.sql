-- DropIndex
DROP INDEX "Invoice_clientOrgId_direction_invoiceNumber_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "counterpartyLegalId" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "sourceChannel" TEXT,
ADD COLUMN     "validationErrorCount" INTEGER,
ADD COLUMN     "validationRuleIds" JSONB,
ALTER COLUMN "lineTotalAmount" DROP NOT NULL,
ALTER COLUMN "allowanceTotalAmount" DROP NOT NULL,
ALTER COLUMN "chargeTotalAmount" DROP NOT NULL,
ALTER COLUMN "taxBasisTotalAmount" DROP NOT NULL,
ALTER COLUMN "taxTotalAmount" DROP NOT NULL,
ALTER COLUMN "grandTotalAmount" DROP NOT NULL,
ALTER COLUMN "prepaidAmount" DROP NOT NULL,
ALTER COLUMN "duePayableAmount" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Invoice_tenantId_direction_issueDate_idx" ON "Invoice"("tenantId", "direction", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_counterpartyLegalId_idx" ON "Invoice"("counterpartyLegalId");

-- ---------------------------------------------------------------------------
-- Hand-written below this line. Prisma's DSL cannot express partial indexes or
-- CHECK constraints, and both encode rules that must hold in the database
-- rather than only in the service that happens to write today.
-- ---------------------------------------------------------------------------

-- Sequential numbering is an obligation on the ISSUER (art. 242 nonies A of annexe II to the
-- CGI): a business may not reuse or skip a number in its own sequence. It says nothing about
-- documents that business receives.
CREATE UNIQUE INDEX "Invoice_issued_number_key"
  ON "Invoice" ("clientOrgId", "invoiceNumber")
  WHERE "direction" = 'ISSUED';

-- For a received invoice the number belongs to the supplier, so it is only unique per supplier.
-- Two suppliers both numbering an invoice `FA-2026-001` is ordinary, and the previous constraint
-- - which spanned direction but not the counterparty - rejected the second one as a duplicate.
--
-- Supplier identity can be absent on a malformed invoice, and Postgres treats NULLs as distinct
-- in a unique index, so those fall through to content-hash deduplication in ReceptionService.
CREATE UNIQUE INDEX "Invoice_received_supplier_number_key"
  ON "Invoice" ("clientOrgId", "counterpartyLegalId", "invoiceNumber")
  WHERE "direction" = 'RECEIVED' AND "counterpartyLegalId" IS NOT NULL;

-- The totals became nullable so that a malformed *received* invoice can be recorded honestly
-- rather than with a fabricated zero. Nothing about invoices we issue changes: we compute every
-- total before writing, and this makes that a property of the table rather than a habit of the
-- code. A future bug that tries to issue an invoice with a missing total fails here.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issued_totals_present"
  CHECK (
    "direction" <> 'ISSUED' OR (
      "lineTotalAmount"     IS NOT NULL AND
      "taxBasisTotalAmount" IS NOT NULL AND
      "taxTotalAmount"      IS NOT NULL AND
      "grandTotalAmount"    IS NOT NULL AND
      "duePayableAmount"    IS NOT NULL
    )
  );

-- An invoice we received must say when, and one we issued must not pretend to have been received.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_received_has_timestamp"
  CHECK (("direction" = 'RECEIVED') = ("receivedAt" IS NOT NULL));
