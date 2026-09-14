-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'LIVE', 'DONE');

-- AlterTable
ALTER TABLE "Placement" DROP COLUMN "kos",
DROP COLUMN "roomIndex",
ADD COLUMN     "setsLost" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "setsWon" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "WeeklyEvent" ADD COLUMN     "seedOrder" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "p1Id" TEXT,
    "p2Id" TEXT,
    "winnerId" TEXT,
    "score1" INTEGER NOT NULL DEFAULT 0,
    "score2" INTEGER NOT NULL DEFAULT 0,
    "games" JSONB NOT NULL DEFAULT '[]',
    "forfeit" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_eventId_matchKey_key" ON "TournamentMatch"("eventId", "matchKey");

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WeeklyEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_p1Id_fkey" FOREIGN KEY ("p1Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_p2Id_fkey" FOREIGN KEY ("p2Id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

