-- Webhook tokens for early polling.
--
-- Only the SHA-256 of the token is stored, never the token, so a leaked backup yields nothing a
-- caller could present. A connection with a NULL hash has no webhook configured and its endpoint
-- refuses every call - which is the safe default for the connections that already exist.
-- AlterTable
ALTER TABLE "PdpConnection" ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "webhookSecretHash" TEXT;
