-- Songs can now hold several instruments. Each song has one or more tracks (a piano, a violin, a drum
-- kit, ...) and every note belongs to a track instead of directly to the song.

-- CreateTable
CREATE TABLE "song_tracks" (
    "id" TEXT NOT NULL,
    "song_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "instrument" TEXT NOT NULL DEFAULT 'piano',
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "muted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "song_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "song_tracks_song_id_position_key" ON "song_tracks"("song_id", "position");

-- AddForeignKey
ALTER TABLE "song_tracks" ADD CONSTRAINT "song_tracks_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing song gets one piano track that takes over all of its notes.
INSERT INTO "song_tracks" ("id", "song_id", "position", "name", "instrument")
SELECT gen_random_uuid()::text, "id", 0, 'Piano', 'piano' FROM "songs";

ALTER TABLE "song_notes" ADD COLUMN "track_id" TEXT;

UPDATE "song_notes" AS n
SET "track_id" = t."id"
FROM "song_tracks" AS t
WHERE t."song_id" = n."song_id";

ALTER TABLE "song_notes" ALTER COLUMN "track_id" SET NOT NULL;

-- Notes now reach their song through the track.
ALTER TABLE "song_notes" DROP CONSTRAINT "song_notes_song_id_fkey";
DROP INDEX "song_notes_song_id_idx";
ALTER TABLE "song_notes" DROP COLUMN "song_id";

-- CreateIndex
CREATE INDEX "song_notes_track_id_idx" ON "song_notes"("track_id");

-- AddForeignKey
ALTER TABLE "song_notes" ADD CONSTRAINT "song_notes_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "song_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
