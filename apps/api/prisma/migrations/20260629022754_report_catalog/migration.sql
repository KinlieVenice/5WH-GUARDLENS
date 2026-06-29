-- CreateTable
CREATE TABLE `ReportType` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `lane` ENUM('SECURITY', 'SAFETY') NOT NULL DEFAULT 'SECURITY',
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportType_tenantId_lane_idx`(`tenantId`, `lane`),
    UNIQUE INDEX `ReportType_tenantId_key_key`(`tenantId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportTypeVersion` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `reportTypeId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `schema` JSON NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportTypeVersion_tenantId_reportTypeId_idx`(`tenantId`, `reportTypeId`),
    UNIQUE INDEX `ReportTypeVersion_reportTypeId_version_key`(`reportTypeId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReportType` ADD CONSTRAINT `ReportType_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportTypeVersion` ADD CONSTRAINT `ReportTypeVersion_reportTypeId_fkey` FOREIGN KEY (`reportTypeId`) REFERENCES `ReportType`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
