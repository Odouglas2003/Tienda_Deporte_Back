ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Order" ADD COLUMN "customerName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "customerEmail" TEXT NOT NULL DEFAULT '';
UPDATE "Order" AS o SET "customerName" = u."name", "customerEmail" = u."email" FROM "User" AS u WHERE o."userId" = u."id";
