ALTER TABLE "OrderItem" ADD COLUMN "image" TEXT NOT NULL DEFAULT '';
CREATE TABLE "OrderApprovalEmail" (
 "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "firstAttemptAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OrderApprovalEmail_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OrderApprovalEmail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderApprovalEmail_orderId_key" ON "OrderApprovalEmail"("orderId");
CREATE INDEX "OrderApprovalEmail_status_nextAttemptAt_idx" ON "OrderApprovalEmail"("status", "nextAttemptAt");
