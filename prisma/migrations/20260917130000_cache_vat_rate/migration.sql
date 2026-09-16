ALTER TABLE "Settings"
  ADD COLUMN "vatRateCached" DOUBLE PRECISION,
  ADD COLUMN "vatRateCheckedAt" TIMESTAMP(3),
  ADD COLUMN "vatRateAttemptedAt" TIMESTAMP(3);
