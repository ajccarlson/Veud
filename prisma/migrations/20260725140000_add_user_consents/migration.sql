CREATE TABLE "UserConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserConsent_userId_document_version_key" ON "UserConsent"("userId", "document", "version");
CREATE INDEX "UserConsent_document_version_acceptedAt_idx" ON "UserConsent"("document", "version", "acceptedAt");
