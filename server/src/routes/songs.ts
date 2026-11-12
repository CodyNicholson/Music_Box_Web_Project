import type { FastifyInstance } from 'fastify';
import type { Song, SongNote, SongTrack } from '@prisma/client';
import { prisma } from '../db.js';
import { songSchema, type SongInput } from '../schemas.js';

type SongWithTracks = Song & { tracks: (SongTrack & { notes: SongNote[] })[] };

function toSongDto(song: SongWithTracks) {
  return {
    id: song.id,
    userId: song.userId,
    title: song.title,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
    tracks: song.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      instrument: t.instrument,
      volume: t.volume,
      muted: t.muted,
      notes: t.notes.map((n) => ({
        id: n.id,
        pitch: n.pitch,
        startTime: n.startTime,
        duration: n.duration,
        velocity: n.velocity,
      })),
    })),
  };
}

/** Nested create input: the song's tracks in order, each with its note rows. */
function trackRows(input: SongInput) {
  return input.tracks.map((t, position) => ({
    position,
    name: t.name,
    instrument: t.instrument,
    volume: t.volume ?? 0.8,
    muted: t.muted ?? false,
    notes: {
      create: t.notes.map((n) => ({
        pitch: n.pitch,
        startTime: n.startTime,
        duration: n.duration,
        velocity: n.velocity ?? 0.8,
      })),
    },
  }));
}

const tracksInOrder = {
  orderBy: { position: 'asc' as const },
  include: { notes: { orderBy: [{ startTime: 'asc' as const }, { pitch: 'asc' as const }] } },
};

export async function songRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/songs', async (request) => {
    const songs = await prisma.song.findMany({
      where: { userId: request.user.sub },
      orderBy: { updatedAt: 'desc' },
      include: {
        tracks: {
          orderBy: { position: 'asc' },
          select: { instrument: true, _count: { select: { notes: true } } },
        },
      },
    });
    return {
      songs: songs.map((s) => ({
        id: s.id,
        title: s.title,
        bpm: s.bpm,
        timeSignature: s.timeSignature,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        noteCount: s.tracks.reduce((sum, t) => sum + t._count.notes, 0),
        instruments: s.tracks.map((t) => t.instrument),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/songs/:id', async (request, reply) => {
    const song = await prisma.song.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
      include: { tracks: tracksInOrder },
    });
    if (!song) return reply.code(404).send({ error: 'Song not found' });
    return { song: toSongDto(song) };
  });

  app.post('/api/songs', async (request, reply) => {
    const parsed = songSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid song', issues: parsed.error.issues });
    }
    const { title, bpm, timeSignature } = parsed.data;

    // Nested create runs the song, its tracks and their note rows in one transaction.
    const song = await prisma.song.create({
      data: {
        title,
        bpm,
        timeSignature,
        userId: request.user.sub,
        tracks: { create: trackRows(parsed.data) },
      },
      include: { tracks: tracksInOrder },
    });
    return reply.code(201).send({ song: toSongDto(song) });
  });

  app.put<{ Params: { id: string } }>('/api/songs/:id', async (request, reply) => {
    const parsed = songSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid song', issues: parsed.error.issues });
    }
    const { title, bpm, timeSignature } = parsed.data;

    const song = await prisma.$transaction(async (tx) => {
      const owned = await tx.song.findFirst({
        where: { id: request.params.id, userId: request.user.sub },
        select: { id: true },
      });
      if (!owned) return null;

      // Replacing the tracks also replaces their notes (cascading delete).
      return tx.song.update({
        where: { id: owned.id },
        data: {
          title,
          bpm,
          timeSignature,
          tracks: { deleteMany: {}, create: trackRows(parsed.data) },
        },
        include: { tracks: tracksInOrder },
      });
    });

    if (!song) return reply.code(404).send({ error: 'Song not found' });
    return { song: toSongDto(song) };
  });

  app.delete<{ Params: { id: string } }>('/api/songs/:id', async (request, reply) => {
    const { count } = await prisma.song.deleteMany({
      where: { id: request.params.id, userId: request.user.sub },
    });
    if (count === 0) return reply.code(404).send({ error: 'Song not found' });
    return reply.code(204).send();
  });
}
