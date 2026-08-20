-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "avalaiKeyEnc" TEXT,
    "avalaiBaseUrl" TEXT NOT NULL DEFAULT 'https://api.avalai.ir/v1',
    "defaultModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',

    CONSTRAINT "Config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestMetric" (
    "id" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "costEstimate" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "errorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

-- CreateIndex
CREATE INDEX "RequestMetric_createdAt_idx" ON "RequestMetric"("createdAt");

-- CreateIndex
CREATE INDEX "RequestMetric_clientUuid_idx" ON "RequestMetric"("clientUuid");
