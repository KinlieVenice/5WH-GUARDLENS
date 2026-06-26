-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `impersonatedBy` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `correctsId` VARCHAR(191) NULL,

    INDEX `AuditLog_tenantId_entityType_entityId_idx`(`tenantId`, `entityType`, `entityId`),
    INDEX `AuditLog_tenantId_at_idx`(`tenantId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_correctsId_fkey` FOREIGN KEY (`correctsId`) REFERENCES `AuditLog`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only enforcement. BEFORE UPDATE/DELETE triggers reject any direct mutation.
-- Note: MySQL does NOT fire these on FK ON DELETE CASCADE, so deleting a Tenant still
-- cascade-clears its AuditLog rows (used by tenant offboarding and test cleanup).
CREATE TRIGGER auditlog_no_update BEFORE UPDATE ON `AuditLog`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only';
CREATE TRIGGER auditlog_no_delete BEFORE DELETE ON `AuditLog`
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only';
