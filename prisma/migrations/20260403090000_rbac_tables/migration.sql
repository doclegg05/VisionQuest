-- CreateTable: Role
CREATE TABLE "visionquest"."Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "hierarchyLevel" INTEGER NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Permission
CREATE TABLE "visionquest"."Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RolePermission
CREATE TABLE "visionquest"."RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Role.name unique
CREATE UNIQUE INDEX "Role_name_key" ON "visionquest"."Role"("name");

-- CreateIndex: Permission.key unique
CREATE UNIQUE INDEX "Permission_key_key" ON "visionquest"."Permission"("key");

-- CreateIndex: Permission.namespace index
CREATE INDEX "Permission_namespace_idx" ON "visionquest"."Permission"("namespace");

-- CreateIndex: RolePermission unique constraint
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "visionquest"."RolePermission"("roleId", "permissionId");

-- AddForeignKey: RolePermission -> Role
ALTER TABLE "visionquest"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "visionquest"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: RolePermission -> Permission
ALTER TABLE "visionquest"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "visionquest"."Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
