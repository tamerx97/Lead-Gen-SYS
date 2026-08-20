-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('json', 'form', 'xml');

-- CreateEnum
CREATE TYPE "PingStatus" AS ENUM ('open', 'no_bid', 'posted', 'expired');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('sold', 'delivered', 'delivery_failed', 'rejected_dup');

-- CreateTable
CREATE TABLE "Vertical" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fieldSchema" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vertical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deliveryUrl" TEXT,
    "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'json',
    "deliveryHeaders" JSONB NOT NULL DEFAULT '{}',
    "fieldMapping" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bid" DECIMAL(10,2) NOT NULL,
    "routingPriority" INTEGER NOT NULL DEFAULT 100,
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "zips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filters" JSONB NOT NULL DEFAULT '[]',
    "dailyCap" INTEGER NOT NULL DEFAULT 0,
    "monthlyCap" INTEGER NOT NULL DEFAULT 0,
    "concurrencyCap" INTEGER NOT NULL DEFAULT 0,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ping" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "matched" JSONB NOT NULL DEFAULT '[]',
    "rejected" JSONB NOT NULL DEFAULT '[]',
    "bestCampaignId" TEXT,
    "bestBid" DECIMAL(10,2),
    "status" "PingStatus" NOT NULL DEFAULT 'open',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "pingId" TEXT,
    "sourceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "buyerId" TEXT,
    "verticalId" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "payload" JSONB NOT NULL,
    "phoneHash" TEXT,
    "emailHash" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'sold',
    "deliveryResponse" JSONB,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vertical_key_key" ON "Vertical"("key");

-- CreateIndex
CREATE INDEX "Vertical_active_idx" ON "Vertical"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Source_apiKey_key" ON "Source"("apiKey");

-- CreateIndex
CREATE INDEX "Source_active_idx" ON "Source"("active");

-- CreateIndex
CREATE INDEX "Campaign_verticalId_active_idx" ON "Campaign"("verticalId", "active");

-- CreateIndex
CREATE INDEX "Campaign_buyerId_idx" ON "Campaign"("buyerId");

-- CreateIndex
CREATE INDEX "Ping_sourceId_createdAt_idx" ON "Ping"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "Ping_verticalId_createdAt_idx" ON "Ping"("verticalId", "createdAt");

-- CreateIndex
CREATE INDEX "Ping_status_idx" ON "Ping"("status");

-- CreateIndex
CREATE INDEX "Ping_createdAt_idx" ON "Ping"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_verticalId_phoneHash_emailHash_idx" ON "Lead"("verticalId", "phoneHash", "emailHash");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_campaignId_createdAt_idx" ON "Lead"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_buyerId_createdAt_idx" ON "Lead"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_sourceId_createdAt_idx" ON "Lead"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ping" ADD CONSTRAINT "Ping_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ping" ADD CONSTRAINT "Ping_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pingId_fkey" FOREIGN KEY ("pingId") REFERENCES "Ping"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;
