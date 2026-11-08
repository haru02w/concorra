-- pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "workosOrgId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "porte" TEXT NOT NULL DEFAULT 'DEMAIS',
    "cnaePrincipal" TEXT,
    "cnaesSecundarios" TEXT[],
    "endereco" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "representante" TEXT,
    "ufs" TEXT[],
    "municipios" TEXT[],
    "valueMin" DOUBLE PRECISION,
    "valueMax" DOUBLE PRECISION,
    "expertiseText" TEXT NOT NULL DEFAULT '',
    "planId" TEXT NOT NULL DEFAULT 'free',
    "profileEmbedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "workosUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experience" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileId" TEXT,
    "issuer" TEXT,
    "object" TEXT NOT NULL,
    "quantities" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "numeroControlePNCP" TEXT NOT NULL,
    "orgaoCnpj" TEXT NOT NULL,
    "orgaoNome" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "sequencial" INTEGER NOT NULL,
    "numeroCompra" TEXT,
    "processo" TEXT,
    "objeto" TEXT NOT NULL,
    "informacaoComplementar" TEXT,
    "modalidadeId" INTEGER NOT NULL,
    "modalidadeNome" TEXT NOT NULL,
    "modoDisputa" TEXT,
    "situacao" TEXT,
    "valorEstimado" DOUBLE PRECISION,
    "uf" TEXT,
    "municipioIbge" TEXT,
    "municipioNome" TEXT,
    "unidadeNome" TEXT,
    "dataPublicacao" TIMESTAMP(3),
    "dataAbertura" TIMESTAMP(3),
    "dataEncerramento" TIMESTAMP(3),
    "linkSistemaOrigem" TEXT,
    "linkProcessoEletronico" TEXT,
    "updatedAtPncp" TIMESTAMP(3),
    "filesIngestedAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeItem" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "numeroItem" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DOUBLE PRECISION,
    "unidade" TEXT,
    "valorUnitario" DOUBLE PRECISION,
    "valorTotal" DOUBLE PRECISION,
    "embedding" vector(768),

    CONSTRAINT "NoticeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeFile" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "sequencialDocumento" INTEGER NOT NULL,
    "tipo" TEXT,
    "titulo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "pageCount" INTEGER,
    "ocr" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NoticeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticePage" (
    "id" TEXT NOT NULL,
    "noticeFileId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "NoticePage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeChunk" (
    "id" TEXT NOT NULL,
    "noticeFileId" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(768),

    CONSTRAINT "NoticeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractItem" (
    "id" TEXT NOT NULL,
    "numeroControlePNCP" TEXT NOT NULL,
    "numeroItem" INTEGER NOT NULL,
    "orgaoCnpj" TEXT NOT NULL,
    "orgaoNome" TEXT,
    "descricao" TEXT NOT NULL,
    "unidade" TEXT,
    "quantidade" DOUBLE PRECISION,
    "valorUnitario" DOUBLE PRECISION NOT NULL,
    "dataAssinatura" TIMESTAMP(3),
    "uf" TEXT,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "semanticThreshold" DOUBLE PRECISION,
    "minScore" INTEGER,
    "channels" TEXT[],
    "frequency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "channels" TEXT[],
    "minScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "extraction" JSONB,
    "citationReport" JSONB,
    "score" INTEGER,
    "scoreFactors" JSONB,
    "gaps" JSONB,
    "recommendation" TEXT,
    "recommendationReasons" JSONB,
    "cnaeCompatible" BOOLEAN,
    "model" TEXT,
    "error" TEXT,
    "noticeVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "analysisId" TEXT,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "packStatus" TEXT NOT NULL DEFAULT 'idle',
    "packSteps" TEXT[],
    "packError" TEXT,
    "proposalLines" JSONB NOT NULL DEFAULT '[]',
    "priceReferences" JSONB NOT NULL DEFAULT '{}',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "aiSlots" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "verification" JSONB NOT NULL DEFAULT '[]',
    "docxFileId" TEXT,
    "pdfFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'uploaded',
    "fileId" TEXT NOT NULL,
    "issuer" TEXT,
    "cnpj" TEXT,
    "issuedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "extracted" JSONB,
    "status" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "expiryNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "storageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "calendarId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pendingPlanId" TEXT,
    "status" TEXT NOT NULL,
    "customerRef" TEXT,
    "checkoutRef" TEXT,
    "subscriptionRef" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyValue" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyValue_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_workosOrgId_key" ON "Organization"("workosOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_cnpj_key" ON "Organization"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "User_workosUserId_key" ON "User"("workosUserId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Experience_organizationId_idx" ON "Experience"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Notice_numeroControlePNCP_key" ON "Notice"("numeroControlePNCP");

-- CreateIndex
CREATE INDEX "Notice_dataEncerramento_idx" ON "Notice"("dataEncerramento");

-- CreateIndex
CREATE INDEX "Notice_uf_idx" ON "Notice"("uf");

-- CreateIndex
CREATE INDEX "Notice_modalidadeId_idx" ON "Notice"("modalidadeId");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeItem_noticeId_numeroItem_key" ON "NoticeItem"("noticeId", "numeroItem");

-- CreateIndex
CREATE UNIQUE INDEX "NoticeFile_noticeId_sequencialDocumento_key" ON "NoticeFile"("noticeId", "sequencialDocumento");

-- CreateIndex
CREATE UNIQUE INDEX "NoticePage_noticeFileId_page_key" ON "NoticePage"("noticeFileId", "page");

-- CreateIndex
CREATE INDEX "NoticeChunk_noticeFileId_idx" ON "NoticeChunk"("noticeFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractItem_numeroControlePNCP_numeroItem_key" ON "ContractItem"("numeroControlePNCP", "numeroItem");

-- CreateIndex
CREATE INDEX "Rule_organizationId_idx" ON "Rule"("organizationId");

-- CreateIndex
CREATE INDEX "Rule_active_idx" ON "Rule"("active");

-- CreateIndex
CREATE INDEX "Match_organizationId_createdAt_idx" ON "Match"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Match_status_frequency_idx" ON "Match"("status", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "Match_ruleId_noticeId_key" ON "Match"("ruleId", "noticeId");

-- CreateIndex
CREATE INDEX "Analysis_organizationId_noticeId_createdAt_idx" ON "Analysis"("organizationId", "noticeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_organizationId_noticeId_key" ON "Bid"("organizationId", "noticeId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_bidId_key_key" ON "GeneratedDocument"("bidId", "key");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_validUntil_idx" ON "Document"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_organizationId_provider_key" ON "CalendarConnection"("userId", "organizationId", "provider");

-- CreateIndex
CREATE INDEX "CalendarEvent_refType_refId_idx" ON "CalendarEvent"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_connectionId_key_key" ON "CalendarEvent"("connectionId", "key");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_createdAt_idx" ON "Notification"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Subscription_checkoutRef_idx" ON "Subscription"("checkoutRef");

-- CreateIndex
CREATE INDEX "Subscription_subscriptionRef_idx" ON "Subscription"("subscriptionRef");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_organizationId_metric_period_key" ON "UsageCounter"("organizationId", "metric", "period");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key" ON "WebhookEvent"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeItem" ADD CONSTRAINT "NoticeItem_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeFile" ADD CONSTRAINT "NoticeFile_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticePage" ADD CONSTRAINT "NoticePage_noticeFileId_fkey" FOREIGN KEY ("noticeFileId") REFERENCES "NoticeFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeChunk" ADD CONSTRAINT "NoticeChunk_noticeFileId_fkey" FOREIGN KEY ("noticeFileId") REFERENCES "NoticeFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW indexes for cosine similarity (pgvector, 768 dims)
CREATE INDEX "Notice_embedding_hnsw" ON "Notice" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "NoticeChunk_embedding_hnsw" ON "NoticeChunk" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "ContractItem_embedding_hnsw" ON "ContractItem" USING hnsw ("embedding" vector_cosine_ops);
