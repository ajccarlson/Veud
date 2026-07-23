-- Prisma 6 represents implicit PostgreSQL many-to-many join-table uniqueness
-- with a composite primary key instead of the unique indexes emitted by
-- Prisma 5. The indexed B columns remain in place for reverse lookups.
DROP INDEX "_PermissionToRole_AB_unique";
ALTER TABLE "_PermissionToRole"
ADD CONSTRAINT "_PermissionToRole_AB_pkey" PRIMARY KEY ("A", "B");

DROP INDEX "_RoleToUser_AB_unique";
ALTER TABLE "_RoleToUser"
ADD CONSTRAINT "_RoleToUser_AB_pkey" PRIMARY KEY ("A", "B");
