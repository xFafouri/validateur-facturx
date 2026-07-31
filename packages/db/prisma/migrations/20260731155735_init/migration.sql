-- CreateEnum
CREATE TYPE "LeadProfile" AS ENUM ('TPE', 'ACCOUNTANT', 'SOFTWARE_VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ACCOUNTANT', 'CLIENT_USER');

-- CreateEnum
CREATE TYPE "InvoiceDirection" AS ENUM ('ISSUED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "InvoiceState" AS ENUM ('DRAFT', 'VALIDATED', 'QUEUED', 'TRANSMITTED', 'DELIVERED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StatusSource" AS ENUM ('INTERNAL', 'PA', 'PPF');

-- CreateEnum
CREATE TYPE "TransmissionState" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'FAILED');

-- CreateEnum
CREATE TYPE "EReportKind" AS ENUM ('B2C', 'CROSS_BORDER', 'PAYMENT');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "profile" "LeadProfile" NOT NULL DEFAULT 'OTHER',
    "source" TEXT,
    "consentText" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siren" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'ACCOUNTANT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOrg" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siren" TEXT NOT NULL,
    "siret" TEXT,
    "vatNumber" TEXT,
    "eInvoicingAddress" TEXT,
    "eInvoicingScheme" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'FR',
    "defaultProfile" TEXT NOT NULL DEFAULT 'BASIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ClientOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOrgUser" (
    "userId" TEXT NOT NULL,
    "clientOrgId" TEXT NOT NULL,

    CONSTRAINT "ClientOrgUser_pkey" PRIMARY KEY ("userId","clientOrgId")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalId" TEXT,
    "legalScheme" TEXT,
    "vatNumber" TEXT,
    "eAddress" TEXT,
    "eScheme" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postcode" TEXT,
    "city" TEXT,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientOrgId" TEXT NOT NULL,
    "direction" "InvoiceDirection" NOT NULL,
    "state" "InvoiceState" NOT NULL DEFAULT 'DRAFT',
    "invoiceNumber" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL DEFAULT '380',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "buyerReference" TEXT,
    "profile" TEXT NOT NULL DEFAULT 'BASIC',
    "sellerPartyId" TEXT NOT NULL,
    "buyerPartyId" TEXT NOT NULL,
    "lineTotalAmount" DECIMAL(19,4) NOT NULL,
    "allowanceTotalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "chargeTotalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxBasisTotalAmount" DECIMAL(19,4) NOT NULL,
    "taxTotalAmount" DECIMAL(19,4) NOT NULL,
    "grandTotalAmount" DECIMAL(19,4) NOT NULL,
    "prepaidAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "duePayableAmount" DECIMAL(19,4) NOT NULL,
    "lastValidationValid" BOOLEAN,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unitCode" TEXT NOT NULL DEFAULT 'C62',
    "netUnitPrice" DECIMAL(19,4) NOT NULL,
    "netAmount" DECIMAL(19,4) NOT NULL,
    "vatCategoryCode" TEXT NOT NULL DEFAULT 'S',
    "vatRatePercent" DECIMAL(6,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxBreakdown" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "basisAmount" DECIMAL(19,4) NOT NULL,
    "calculatedAmount" DECIMAL(19,4) NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "ratePercent" DECIMAL(6,2) NOT NULL,
    "exemptionReason" TEXT,
    "exemptionCode" TEXT,

    CONSTRAINT "TaxBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifecycleStatus" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "source" "StatusSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "LifecycleStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdpConnection" (
    "id" TEXT NOT NULL,
    "clientOrgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "apiBaseUrl" TEXT,
    "credentialsEncrypted" BYTEA,
    "peppolAddress" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transmission" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "pdpConnectionId" TEXT NOT NULL,
    "state" "TransmissionState" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "externalId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "Transmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "artifactKind" TEXT NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retentionUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EReport" (
    "id" TEXT NOT NULL,
    "clientOrgId" TEXT NOT NULL,
    "kind" "EReportKind" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "taxAmount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "submittedAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "seatCount" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_key" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_profile_idx" ON "Lead"("profile");

-- CreateIndex
CREATE INDEX "Tenant_siren_idx" ON "Tenant"("siren");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "ClientOrg_tenantId_idx" ON "ClientOrg"("tenantId");

-- CreateIndex
CREATE INDEX "ClientOrg_siren_idx" ON "ClientOrg"("siren");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOrg_tenantId_siren_key" ON "ClientOrg"("tenantId", "siren");

-- CreateIndex
CREATE INDEX "ClientOrgUser_clientOrgId_idx" ON "ClientOrgUser"("clientOrgId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_state_idx" ON "Invoice"("tenantId", "state");

-- CreateIndex
CREATE INDEX "Invoice_clientOrgId_issueDate_idx" ON "Invoice"("clientOrgId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clientOrgId_direction_invoiceNumber_key" ON "Invoice"("clientOrgId", "direction", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineId_key" ON "InvoiceLine"("invoiceId", "lineId");

-- CreateIndex
CREATE INDEX "TaxBreakdown_invoiceId_idx" ON "TaxBreakdown"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxBreakdown_invoiceId_categoryCode_ratePercent_key" ON "TaxBreakdown"("invoiceId", "categoryCode", "ratePercent");

-- CreateIndex
CREATE INDEX "LifecycleStatus_invoiceId_occurredAt_idx" ON "LifecycleStatus"("invoiceId", "occurredAt");

-- CreateIndex
CREATE INDEX "PdpConnection_clientOrgId_idx" ON "PdpConnection"("clientOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Transmission_idempotencyKey_key" ON "Transmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transmission_invoiceId_idx" ON "Transmission"("invoiceId");

-- CreateIndex
CREATE INDEX "Transmission_state_idx" ON "Transmission"("state");

-- CreateIndex
CREATE INDEX "ArchiveEntry_invoiceId_idx" ON "ArchiveEntry"("invoiceId");

-- CreateIndex
CREATE INDEX "ArchiveEntry_retentionUntil_idx" ON "ArchiveEntry"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveEntry_tenantId_contentHash_key" ON "ArchiveEntry"("tenantId", "contentHash");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_occurredAt_idx" ON "AuditLog"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "EReport_clientOrgId_periodStart_idx" ON "EReport"("clientOrgId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOrg" ADD CONSTRAINT "ClientOrg_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOrgUser" ADD CONSTRAINT "ClientOrgUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOrgUser" ADD CONSTRAINT "ClientOrgUser_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "ClientOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "ClientOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sellerPartyId_fkey" FOREIGN KEY ("sellerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_buyerPartyId_fkey" FOREIGN KEY ("buyerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxBreakdown" ADD CONSTRAINT "TaxBreakdown_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleStatus" ADD CONSTRAINT "LifecycleStatus_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdpConnection" ADD CONSTRAINT "PdpConnection_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "ClientOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmission" ADD CONSTRAINT "Transmission_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmission" ADD CONSTRAINT "Transmission_pdpConnectionId_fkey" FOREIGN KEY ("pdpConnectionId") REFERENCES "PdpConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveEntry" ADD CONSTRAINT "ArchiveEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveEntry" ADD CONSTRAINT "ArchiveEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EReport" ADD CONSTRAINT "EReport_clientOrgId_fkey" FOREIGN KEY ("clientOrgId") REFERENCES "ClientOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
