-- Additive assistant runtime configuration. Existing assistant remains disabled.
ALTER TABLE "Config"
    ADD COLUMN "avalaiKeyVersion" INTEGER,
    ADD COLUMN "assistantEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "assistantMinuteLimit" INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN "assistantDayLimit" INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN "assistantConcurrencyLimit" INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN "metricRetentionDays" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "auditRetentionDays" INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN "identifierRotationDays" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Config"
    ALTER COLUMN "defaultModel" SET DEFAULT 'deepseek-v4-flash',
    ADD CONSTRAINT "Config_assistantMinuteLimit_check" CHECK ("assistantMinuteLimit" BETWEEN 1 AND 1000),
    ADD CONSTRAINT "Config_assistantDayLimit_check" CHECK ("assistantDayLimit" BETWEEN 1 AND 100000),
    ADD CONSTRAINT "Config_assistantConcurrencyLimit_check" CHECK ("assistantConcurrencyLimit" BETWEEN 1 AND 100),
    ADD CONSTRAINT "Config_metricRetentionDays_check" CHECK ("metricRetentionDays" BETWEEN 1 AND 3650),
    ADD CONSTRAINT "Config_auditRetentionDays_check" CHECK ("auditRetentionDays" BETWEEN 1 AND 3650),
    ADD CONSTRAINT "Config_identifierRotationDays_check" CHECK ("identifierRotationDays" BETWEEN 1 AND 365);

ALTER TABLE "Config" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Four aligned UTC quota buckets share this table. Domain separation is explicit.
CREATE TABLE "RateLimitBucket" (
    "id" BIGSERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "subjectHmac" TEXT NOT NULL,
    "identifierKeyVersion" INTEGER NOT NULL,
    "windowKind" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RateLimitBucket_domain_check" CHECK ("domain" IN ('ip', 'session')),
    CONSTRAINT "RateLimitBucket_windowKind_check" CHECK ("windowKind" IN ('minute', 'day')),
    CONSTRAINT "RateLimitBucket_count_check" CHECK ("count" >= 0)
);

CREATE UNIQUE INDEX "RateLimitBucket_domain_subjectHmac_windowKind_windowStart_key"
    ON "RateLimitBucket"("domain", "subjectHmac", "windowKind", "windowStart");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- Extend legacy metrics without dropping data. Raw clientUuid becomes optional and must not be written by assistant code.
ALTER TABLE "RequestMetric"
    ALTER COLUMN "clientUuid" DROP NOT NULL,
    ADD COLUMN "requestId" UUID,
    ADD COLUMN "providerRequestId" TEXT,
    ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'chat',
    ADD COLUMN "subjectIpHmac" TEXT,
    ADD COLUMN "subjectSessionHmac" TEXT,
    ADD COLUMN "identifierKeyVersion" INTEGER,
    ADD COLUMN "inputTokens" INTEGER,
    ADD COLUMN "outputTokens" INTEGER,
    ADD COLUMN "estimatedCost" DECIMAL(18,8),
    ADD COLUMN "configRateLatencyMs" INTEGER,
    ADD COLUMN "retrievalLatencyMs" INTEGER,
    ADD COLUMN "firstByteLatencyMs" INTEGER,
    ADD COLUMN "totalLatencyMs" INTEGER,
    ADD COLUMN "sourceCount" INTEGER,
    ADD COLUMN "abstention" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "groundedSuccess" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "evaluationFailure" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "monitoringFailure" BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT "RequestMetric_requestType_check" CHECK ("requestType" IN ('chat', 'docs_assistant')),
    ADD CONSTRAINT "RequestMetric_usage_check" CHECK (
        ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
        ("outputTokens" IS NULL OR "outputTokens" >= 0) AND
        ("sourceCount" IS NULL OR "sourceCount" BETWEEN 0 AND 5)
    );

CREATE UNIQUE INDEX "RequestMetric_requestId_key" ON "RequestMetric"("requestId");
CREATE INDEX "RequestMetric_requestType_createdAt_idx" ON "RequestMetric"("requestType", "createdAt");
CREATE INDEX "RequestMetric_status_createdAt_idx" ON "RequestMetric"("status", "createdAt");
CREATE INDEX "RequestMetric_model_createdAt_idx" ON "RequestMetric"("model", "createdAt");

CREATE TABLE "AssistantAudit" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "administratorId" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ipHmac" TEXT,
    "identifierKeyVersion" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantAudit_createdAt_idx" ON "AssistantAudit"("createdAt");
CREATE INDEX "AssistantAudit_expiresAt_idx" ON "AssistantAudit"("expiresAt");
CREATE INDEX "AssistantAudit_administratorId_createdAt_idx" ON "AssistantAudit"("administratorId", "createdAt");

CREATE TABLE "AssistantReleaseState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ingestionStatus" TEXT NOT NULL DEFAULT 'not_started',
    "evaluationStatus" TEXT NOT NULL DEFAULT 'not_started',
    "candidateCollection" TEXT,
    "activeCollection" TEXT,
    "corpusDigest" TEXT,
    "evaluationDatasetVersion" TEXT,
    "recallAt5" DOUBLE PRECISION,
    "abstentionPrecision" DOUBLE PRECISION,
    "urlValidity" DOUBLE PRECISION,
    "anchorValidity" DOUBLE PRECISION,
    "lastIngestionAt" TIMESTAMP(3),
    "lastEvaluationAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantReleaseState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssistantReleaseState_ingestionStatus_check" CHECK ("ingestionStatus" IN ('not_started', 'running', 'passed', 'failed')),
    CONSTRAINT "AssistantReleaseState_evaluationStatus_check" CHECK ("evaluationStatus" IN ('not_started', 'running', 'passed', 'failed')),
    CONSTRAINT "AssistantReleaseState_scores_check" CHECK (
        ("recallAt5" IS NULL OR "recallAt5" BETWEEN 0 AND 1) AND
        ("abstentionPrecision" IS NULL OR "abstentionPrecision" BETWEEN 0 AND 1) AND
        ("urlValidity" IS NULL OR "urlValidity" BETWEEN 0 AND 1) AND
        ("anchorValidity" IS NULL OR "anchorValidity" BETWEEN 0 AND 1)
    )
);
