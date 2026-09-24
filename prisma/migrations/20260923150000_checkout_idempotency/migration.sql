CREATE TABLE "CheckoutRequest" (
  "keyHash" TEXT NOT NULL,
  "ownerHash" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "orderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutRequest_pkey" PRIMARY KEY ("keyHash")
);
CREATE UNIQUE INDEX "CheckoutRequest_orderId_key" ON "CheckoutRequest"("orderId");
ALTER TABLE "CheckoutRequest" ADD CONSTRAINT "CheckoutRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
