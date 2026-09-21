ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'enviado';
ALTER TABLE "OrderApprovalEmail" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'approval';
DROP INDEX "OrderApprovalEmail_orderId_key";
CREATE UNIQUE INDEX "OrderApprovalEmail_orderId_kind_key" ON "OrderApprovalEmail"("orderId", "kind");
