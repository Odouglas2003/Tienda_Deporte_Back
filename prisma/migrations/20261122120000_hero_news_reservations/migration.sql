ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'reservado';

ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "heroProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "imageData" TEXT NOT NULL DEFAULT '',
    "buttonLabel" TEXT NOT NULL DEFAULT '',
    "buttonUrl" TEXT NOT NULL DEFAULT '',
    "theme" TEXT NOT NULL DEFAULT 'oscuro',
    "layout" TEXT NOT NULL DEFAULT 'arriba',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Announcement_active_updatedAt_idx" ON "Announcement"("active", "updatedAt");

ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionsValidFrom" TIMESTAMP(3);
