-- CreateTable
CREATE TABLE "AgentUsage" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentUsage_businessId_day_key" ON "AgentUsage"("businessId", "day");

-- AddForeignKey
ALTER TABLE "AgentUsage" ADD CONSTRAINT "AgentUsage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Conversation_one_active_per_contact_channel"
  ON "Conversation" ("contactId", "businessChannelId")
  WHERE "status" IN ('OPEN', 'HANDED_OFF');

ALTER TABLE "AgentUsage"
  ADD CONSTRAINT "AgentUsage_non_negative" CHECK ("modelCalls" >= 0 AND "inputTokens" >= 0 AND "outputTokens" >= 0);

ALTER TABLE "AgentUsage" ENABLE ROW LEVEL SECURITY;