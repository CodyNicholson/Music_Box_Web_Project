import type { FastifyInstance } from 'fastify';
import type { Song, SongNote } from '@prisma/client';
import { prisma } from '../db.js';
import { songSchema, type SongInput } from '../schemas.js';

type SongWithNotes = Song & { notes: SongNote[] };

function toSongDto(song: SongWithNotes) {
  return {
    id: song.id,
    userId: song.userId,
    title: song.title,
    bpm: song.bpm,
    timeSignature: song.timeSignature,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
    notes: song.notes.map((n) => ({
      id: n.id,
      pitch: n.pitch,
      startTime: n.startTime,
      duration: n.duration,
      velocity: n.velocity,
    })),
  };
}

function noteRows(input: SongInput) {
  return input.notes.map((n) => ({
    pitch: n.pitch,
    startTime: n.startTime,
    duration: n.duration,
    velocity: n.velocity ?? 0.8,
  }));
}

const notesInOrder = { orderBy: [{ startTime: 'asc' as const }, { pitch: 'asc' as const }] };

export async function songRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/songs', async (request) => {
    const songs = await prisma.song.findMany({
      where: { userId: request.user.sub },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { notes: true } } },
    });
    return {
      songs: songs.map((s) => ({
        id: s.id,
        title: s.title,
        bpm: s.bpm,
        timeSignature: s.timeSignature,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        noteCount: s._count.notes,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/songs/:id', async (request, reply) => {
    const song = await prisma.song.findFirst({
      where: { id: request.params.id, userId: request.user.sub },
      include: { notes: notesInOrder },
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

    // Nested create runs the song and its note rows in one transaction.
    const song = await prisma.song.create({
      data: {
        title,
        bpm,
        timeSignature,
        userId: request.user.sub,
        notes: { create: noteRows(parsed.data) },
      },
      include: { notes: notesInOrder },
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

      return tx.song.update({
        where: { id: owned.id },
        data: {
          title,
          bpm,
          timeSignature,
          notes: { deleteMany: {}, create: noteRows(parsed.data) },
        },
        include: { notes: notesInOrder },
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
