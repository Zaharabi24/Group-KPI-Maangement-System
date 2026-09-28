-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'HR_ADMIN', 'DEPT_HEAD', 'EMPLOYEE', 'MGMT_VIEWER', 'SYS_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'INACTIVE', 'LOCKED');

-- CreateEnum
CREATE TYPE "KpiType" AS ENUM ('VARIABLE', 'FIXED', 'PROJECT', 'PEOPLE_CULTURE', 'TYPE_5');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('COUNT', 'MONETARY', 'PERCENTAGE', 'TIME', 'RATING', 'QUALITATIVE');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('HIGHER', 'LOWER');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "KpiStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'ESCALATED', 'APPROVED', 'REJECTED', 'NOT_SUBMITTED', 'DELETED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "KpiCategoryCode" AS ENUM ('FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'PEOPLE_LEARNING');

-- CreateEnum
CREATE TYPE "EvidenceScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('APPROVE', 'ADJUST', 'RETURN', 'REJECT', 'DELETE', 'ESCALATION_APPROVE', 'ESCALATION_DECLINE', 'CORRECTION_APPROVE', 'CORRECTION_DECLINE', 'WITHDRAW', 'BULK_APPROVE', 'EXTENSION_GRANT', 'PERIOD_REOPEN');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('ACTIVATION', 'INVITATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TemplateScope" AS ENUM ('GROUP', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'BOTH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('XLSX', 'CSV', 'PDF');

-- CreateEnum
CREATE TYPE "RagStatus" AS ENUM ('GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "RejectCategory" AS ENUM ('NOT_MEASURABLE', 'NOT_ALIGNED_TO_ROLE', 'DUPLICATE', 'INSUFFICIENT_EVIDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('USER', 'SYSTEM', 'ANONYMOUS');

-- CreateTable
CREATE TABLE "business_unit" (
    "id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "shortName" VARCHAR(64),
    "division" VARCHAR(80),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "businessUnitId" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_head" (
    "id" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designation" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "level" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" VARCHAR(190) NOT NULL,
    "employeeCode" VARCHAR(32) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "passwordHash" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "corporatePhone" VARCHAR(24),
    "designationId" UUID,
    "designationTitle" VARCHAR(160),
    "businessUnitId" UUID,
    "departmentId" UUID,
    "organisationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "emailDigest" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "breakGlassAccess" BOOLEAN NOT NULL DEFAULT false,
    "deactivatedAt" TIMESTAMP(3),
    "deactivationReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(400),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "grantedById" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_scope" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "businessUnitId" UUID,
    "departmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_scope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approver_delegation" (
    "id" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approver_delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" VARCHAR(255) NOT NULL,
    "userAgent" VARCHAR(400),
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(160),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "email" VARCHAR(190),
    "type" "TokenType" NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" UUID NOT NULL,
    "email" VARCHAR(190) NOT NULL,
    "employeeCode" VARCHAR(32) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "businessUnitId" UUID,
    "departmentId" UUID,
    "roleId" UUID NOT NULL,
    "designation" VARCHAR(160),
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_version" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "scoreCap" DECIMAL(7,2) NOT NULL DEFAULT 120.00,
    "scoreFloor" DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    "adjustmentBand" DECIMAL(7,2) NOT NULL DEFAULT 10.00,
    "minWeight" INTEGER NOT NULL DEFAULT 5,
    "maxWeight" INTEGER NOT NULL DEFAULT 50,
    "maxKpisPerPeriod" INTEGER NOT NULL DEFAULT 10,
    "submissionGraceDays" INTEGER NOT NULL DEFAULT 7,
    "reviewWindowDays" INTEGER NOT NULL DEFAULT 7,
    "reviewSlaDays" INTEGER NOT NULL DEFAULT 5,
    "extensionMaxDays" INTEGER NOT NULL DEFAULT 7,
    "minReasonLength" INTEGER NOT NULL DEFAULT 15,
    "maxEvidenceFiles" INTEGER NOT NULL DEFAULT 5,
    "maxEvidenceSizeMb" INTEGER NOT NULL DEFAULT 10,
    "qualitativeMap" JSONB NOT NULL DEFAULT '{"1":50,"2":75,"3":100,"4":110,"5":120}',
    "ragThresholds" JSONB NOT NULL DEFAULT '{"green":95,"amber":75}',
    "categories" JSONB NOT NULL DEFAULT '["FINANCIAL","CUSTOMER","INTERNAL_PROCESS","PEOPLE_LEARNING"]',
    "allowedMimeTypes" JSONB NOT NULL DEFAULT '["application/pdf","image/jpeg","image/png","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","text/csv","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuration_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_period" (
    "id" UUID NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "label" VARCHAR(64) NOT NULL,
    "year" INTEGER NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "submissionDeadline" DATE NOT NULL,
    "reviewDeadline" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_extension" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "grantedById" UUID,
    "departmentId" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "days" INTEGER NOT NULL,
    "until" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_extension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_category" (
    "id" UUID NOT NULL,
    "code" "KpiCategoryCode" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kpi_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_template" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000),
    "kpiType" "KpiType" NOT NULL DEFAULT 'VARIABLE',
    "categoryId" UUID NOT NULL,
    "measurementType" "MeasurementType" NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "direction" "Direction" NOT NULL,
    "suggestedWeight" INTEGER NOT NULL,
    "rubricDescriptors" JSONB,
    "scope" "TemplateScope" NOT NULL DEFAULT 'GROUP',
    "businessUnitId" UUID,
    "departmentId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_assignment" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "conflicts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "kpiType" "KpiType" NOT NULL DEFAULT 'VARIABLE',
    "templateId" UUID,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "categoryId" UUID NOT NULL,
    "measurementType" "MeasurementType" NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "direction" "Direction" NOT NULL,
    "target" DECIMAL(18,2),
    "actual" DECIMAL(18,2),
    "rubricLevel" INTEGER,
    "qualitativeMapSnapshot" JSONB,
    "achievement" DECIMAL(12,2),
    "calculatedScore" DECIMAL(7,2),
    "finalScore" DECIMAL(7,2),
    "overrideScore" DECIMAL(7,2),
    "kpiWeight" INTEGER NOT NULL,
    "weightedScore" DECIMAL(7,2),
    "status" "KpiStatus" NOT NULL DEFAULT 'DRAFT',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isAssigned" BOOLEAN NOT NULL DEFAULT false,
    "assignedById" UUID,
    "targetLocked" BOOLEAN NOT NULL DEFAULT false,
    "weightLocked" BOOLEAN NOT NULL DEFAULT false,
    "businessUnitId" UUID,
    "departmentId" UUID,
    "approverId" UUID,
    "remarks" VARCHAR(1000),
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "reviewStartedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "returnedAt" TIMESTAMP(3),
    "returnComment" VARCHAR(1000),
    "rejectedReason" VARCHAR(1000),
    "rejectCategory" "RejectCategory",
    "overdueAt" TIMESTAMP(3),
    "lastCalculatedAt" TIMESTAMP(3),
    "configVersionId" UUID,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "deletedReason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_version" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeReason" VARCHAR(1000),
    "trigger" VARCHAR(60) NOT NULL,
    "calculation" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_evidence" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "originalName" VARCHAR(255) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "extension" VARCHAR(12) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "storageKey" VARCHAR(255) NOT NULL,
    "scanStatus" "EvidenceScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanDetail" VARCHAR(500),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" UUID NOT NULL,
    "replacedById" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_decision" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "onBehalfOfId" UUID,
    "reason" VARCHAR(1000),
    "rejectCategory" "RejectCategory",
    "scoreBefore" DECIMAL(7,2),
    "scoreAfter" DECIMAL(7,2),
    "statusBefore" "KpiStatus",
    "statusAfter" "KpiStatus",
    "rowVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_adjustment" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "decisionId" UUID,
    "field" VARCHAR(40) NOT NULL,
    "oldValue" VARCHAR(255),
    "newValue" VARCHAR(255),
    "reason" VARCHAR(1000) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "calculatedScore" DECIMAL(7,2) NOT NULL,
    "proposedScore" DECIMAL(7,2) NOT NULL,
    "delta" DECIMAL(7,2) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "pendingChanges" JSONB,
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_request" (
    "id" UUID NOT NULL,
    "kpiId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "departmentId" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "changes" JSONB,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" VARCHAR(1000),
    "newVersionNo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_log" (
    "id" UUID NOT NULL,
    "kpiId" UUID,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "formulaText" VARCHAR(1000) NOT NULL,
    "configVersionId" UUID,
    "trigger" VARCHAR(60) NOT NULL,
    "actorId" UUID,
    "durationMs" INTEGER,
    "correlationId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_snapshot" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "departmentId" UUID,
    "businessUnitId" UUID,
    "totalKpiScore" DECIMAL(7,2) NOT NULL,
    "averageAchievement" DECIMAL(12,2) NOT NULL,
    "allocatedWeight" INTEGER NOT NULL,
    "approvedCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "rag" "RagStatus" NOT NULL,
    "rank" INTEGER,
    "previousScore" DECIMAL(7,2),
    "difference" DECIMAL(7,2),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorKind" "AuditActorKind" NOT NULL DEFAULT 'USER',
    "actorRole" VARCHAR(40),
    "action" VARCHAR(80) NOT NULL,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(64),
    "employeeId" UUID,
    "departmentId" UUID,
    "businessUnitId" UUID,
    "before" JSONB,
    "after" JSONB,
    "changedFields" JSONB,
    "reason" VARCHAR(1000),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(400),
    "correlationId" VARCHAR(64),
    "previousHash" VARCHAR(64),
    "recordHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "deepLink" VARCHAR(400),
    "entityType" VARCHAR(60),
    "entityId" VARCHAR(64),
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "severity" VARCHAR(20) NOT NULL DEFAULT 'info',
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_log" (
    "id" UUID NOT NULL,
    "toEmail" VARCHAR(190) NOT NULL,
    "ccEmail" VARCHAR(400),
    "subject" VARCHAR(300) NOT NULL,
    "templateCode" VARCHAR(40),
    "payload" JSONB,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "jobId" VARCHAR(64),
    "lastError" VARCHAR(1000),
    "messageId" VARCHAR(200),
    "userId" UUID,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_job" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reportCode" VARCHAR(12) NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "filters" JSONB,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "filePath" VARCHAR(400),
    "fileName" VARCHAR(255),
    "rowCount" INTEGER,
    "error" VARCHAR(1000),
    "departmentId" UUID,
    "jobId" VARCHAR(64),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_setting" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(400),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "userId" UUID,
    "endpoint" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(64),
    "response" JSONB,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_job_run" (
    "id" UUID NOT NULL,
    "jobName" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "detail" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_job_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_unit_code_key" ON "business_unit"("code");

-- CreateIndex
CREATE INDEX "business_unit_isActive_idx" ON "business_unit"("isActive");

-- CreateIndex
CREATE INDEX "department_businessUnitId_isActive_idx" ON "department"("businessUnitId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "department_businessUnitId_name_key" ON "department"("businessUnitId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "department_businessUnitId_code_key" ON "department"("businessUnitId", "code");

-- CreateIndex
CREATE INDEX "department_head_userId_isActive_idx" ON "department_head"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "department_head_departmentId_userId_key" ON "department_head"("departmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "designation_name_key" ON "designation"("name");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_employeeCode_key" ON "user"("employeeCode");

-- CreateIndex
CREATE INDEX "user_departmentId_status_idx" ON "user"("departmentId", "status");

-- CreateIndex
CREATE INDEX "user_businessUnitId_idx" ON "user"("businessUnitId");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE INDEX "user_role_roleId_idx" ON "user_role"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_userId_roleId_key" ON "user_role"("userId", "roleId");

-- CreateIndex
CREATE INDEX "user_role_scope_userId_idx" ON "user_role_scope"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_scope_userId_roleId_departmentId_key" ON "user_role_scope"("userId", "roleId", "departmentId");

-- CreateIndex
CREATE INDEX "approver_delegation_departmentId_isActive_idx" ON "approver_delegation"("departmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "session_refreshTokenHash_key" ON "session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "session_userId_revokedAt_idx" ON "session"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "token_tokenHash_key" ON "token"("tokenHash");

-- CreateIndex
CREATE INDEX "token_email_type_idx" ON "token"("email", "type");

-- CreateIndex
CREATE INDEX "token_expiresAt_idx" ON "token"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_tokenHash_key" ON "invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "invitation_status_idx" ON "invitation"("status");

-- CreateIndex
CREATE INDEX "invitation_email_idx" ON "invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_version_version_key" ON "configuration_version"("version");

-- CreateIndex
CREATE INDEX "configuration_version_isActive_effectiveFrom_idx" ON "configuration_version"("isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_period_code_key" ON "kpi_period"("code");

-- CreateIndex
CREATE INDEX "kpi_period_frequency_status_idx" ON "kpi_period"("frequency", "status");

-- CreateIndex
CREATE INDEX "kpi_period_year_idx" ON "kpi_period"("year");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_period_frequency_startDate_key" ON "kpi_period"("frequency", "startDate");

-- CreateIndex
CREATE INDEX "kpi_extension_kpiId_idx" ON "kpi_extension"("kpiId");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_category_code_key" ON "kpi_category"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_template_code_key" ON "kpi_template"("code");

-- CreateIndex
CREATE INDEX "kpi_template_scope_departmentId_idx" ON "kpi_template"("scope", "departmentId");

-- CreateIndex
CREATE INDEX "kpi_assignment_periodId_departmentId_idx" ON "kpi_assignment"("periodId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_code_key" ON "kpi"("code");

-- CreateIndex
CREATE INDEX "kpi_approverId_status_idx" ON "kpi"("approverId", "status");

-- CreateIndex
CREATE INDEX "kpi_departmentId_periodId_status_idx" ON "kpi"("departmentId", "periodId", "status");

-- CreateIndex
CREATE INDEX "kpi_employeeId_frequency_periodId_idx" ON "kpi"("employeeId", "frequency", "periodId");

-- CreateIndex
CREATE INDEX "kpi_status_idx" ON "kpi"("status");

-- CreateIndex
CREATE INDEX "kpi_code_idx" ON "kpi"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_employeeId_periodId_name_key" ON "kpi"("employeeId", "periodId", "name");

-- CreateIndex
CREATE INDEX "kpi_version_kpiId_idx" ON "kpi_version"("kpiId");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_version_kpiId_versionNo_key" ON "kpi_version"("kpiId", "versionNo");

-- CreateIndex
CREATE INDEX "kpi_evidence_kpiId_isCurrent_idx" ON "kpi_evidence"("kpiId", "isCurrent");

-- CreateIndex
CREATE INDEX "kpi_decision_kpiId_idx" ON "kpi_decision"("kpiId");

-- CreateIndex
CREATE INDEX "kpi_decision_actorId_createdAt_idx" ON "kpi_decision"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "kpi_adjustment_kpiId_idx" ON "kpi_adjustment"("kpiId");

-- CreateIndex
CREATE INDEX "escalation_status_createdAt_idx" ON "escalation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "correction_request_status_createdAt_idx" ON "correction_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "calculation_log_kpiId_createdAt_idx" ON "calculation_log"("kpiId", "createdAt");

-- CreateIndex
CREATE INDEX "calculation_log_createdAt_idx" ON "calculation_log"("createdAt");

-- CreateIndex
CREATE INDEX "performance_snapshot_periodId_departmentId_idx" ON "performance_snapshot"("periodId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_snapshot_employeeId_periodId_frequency_key" ON "performance_snapshot"("employeeId", "periodId", "frequency");

-- CreateIndex
CREATE INDEX "audit_log_actorId_createdAt_idx" ON "audit_log"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt");

-- CreateIndex
CREATE INDEX "notification_userId_status_idx" ON "notification"("userId", "status");

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "email_log_status_idx" ON "email_log"("status");

-- CreateIndex
CREATE INDEX "email_log_toEmail_idx" ON "email_log"("toEmail");

-- CreateIndex
CREATE INDEX "export_job_userId_status_idx" ON "export_job"("userId", "status");

-- CreateIndex
CREATE INDEX "idempotency_key_createdAt_idx" ON "idempotency_key"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_key_endpoint_key" ON "idempotency_key"("key", "endpoint");

-- CreateIndex
CREATE INDEX "scheduled_job_run_jobName_startedAt_idx" ON "scheduled_job_run"("jobName", "startedAt");

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_head" ADD CONSTRAINT "department_head_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_head" ADD CONSTRAINT "department_head_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scope" ADD CONSTRAINT "user_role_scope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scope" ADD CONSTRAINT "user_role_scope_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scope" ADD CONSTRAINT "user_role_scope_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_scope" ADD CONSTRAINT "user_role_scope_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approver_delegation" ADD CONSTRAINT "approver_delegation_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approver_delegation" ADD CONSTRAINT "approver_delegation_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approver_delegation" ADD CONSTRAINT "approver_delegation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token" ADD CONSTRAINT "token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_version" ADD CONSTRAINT "configuration_version_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_period" ADD CONSTRAINT "kpi_period_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_extension" ADD CONSTRAINT "kpi_extension_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_extension" ADD CONSTRAINT "kpi_extension_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_extension" ADD CONSTRAINT "kpi_extension_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_extension" ADD CONSTRAINT "kpi_extension_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template" ADD CONSTRAINT "kpi_template_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "kpi_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template" ADD CONSTRAINT "kpi_template_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template" ADD CONSTRAINT "kpi_template_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_template" ADD CONSTRAINT "kpi_template_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "kpi_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_assignment" ADD CONSTRAINT "kpi_assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "kpi_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "kpi_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi" ADD CONSTRAINT "kpi_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "configuration_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_version" ADD CONSTRAINT "kpi_version_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_version" ADD CONSTRAINT "kpi_version_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evidence" ADD CONSTRAINT "kpi_evidence_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_evidence" ADD CONSTRAINT "kpi_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_decision" ADD CONSTRAINT "kpi_decision_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_decision" ADD CONSTRAINT "kpi_decision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_adjustment" ADD CONSTRAINT "kpi_adjustment_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_adjustment" ADD CONSTRAINT "kpi_adjustment_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "kpi_decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_adjustment" ADD CONSTRAINT "kpi_adjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_log" ADD CONSTRAINT "calculation_log_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "kpi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_log" ADD CONSTRAINT "calculation_log_configVersionId_fkey" FOREIGN KEY ("configVersionId") REFERENCES "configuration_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_log" ADD CONSTRAINT "calculation_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_snapshot" ADD CONSTRAINT "performance_snapshot_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_snapshot" ADD CONSTRAINT "performance_snapshot_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "kpi_period"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_snapshot" ADD CONSTRAINT "performance_snapshot_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_snapshot" ADD CONSTRAINT "performance_snapshot_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
