CREATE TABLE IF NOT EXISTS "XubioConnection" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "clientIdEnc" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "clientHint" TEXT NOT NULL DEFAULT '',
    "autoSync" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XubioConnection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "XubioConnection" ENABLE ROW LEVEL SECURITY;
