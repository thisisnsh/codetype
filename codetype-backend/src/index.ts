import type {
  Env,
  DecodedToken,
  UserDocument,
  GameDocument,
  VerifyTokenRequest,
  VerifyTokenResponse,
  RegisterRequest,
  SubmitGameRequest,
  SubmitGameResponse,
  UserStatsResponse,
  StreaksResponse,
} from './types';

import {
  getFirebaseConfig,
  verifyIdToken,
  firestoreGet,
  firestoreSet,
  firestoreAdd,
  firestoreQuery,
  updateStreak,
  updateActivity,
  getYearActivity,
  isUsernameAvailable,
  createRoom,
  isRoomCodeTaken,
} from './firebase';

import type { RoomDocument } from './types';

export type { Env };

const allowedMethods = 'GET, POST, PUT, DELETE, OPTIONS';
const allowedHeaders = 'Content-Type, Authorization';

// In-memory rate limiting
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

function getAllowedOrigins(env: Env): string[] {
  if (!env.ALLOWED_ORIGINS) {
    return ['*'];
  }
  return env.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return '*';
  }

  const allowed = getAllowedOrigins(env);
  if (allowed.includes('*') || allowed.includes(origin)) {
    return origin;
  }

  return null;
}

function buildCorsHeaders(origin: string | null): HeadersInit {
  if (!origin) {
    return {};
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': allowedMethods,
    'Access-Control-Allow-Headers': allowedHeaders,
  };

  if (origin !== '*') {
    headers['Vary'] = 'Origin';
  }

  return headers;
}

function buildSecurityHeaders(): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

function jsonResponse(
  request: Request,
  env: Env,
  data: any,
  status = 200
): Response {
  const origin = resolveCorsOrigin(request, env);
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...buildCorsHeaders(origin),
    ...buildSecurityHeaders(),
  });

  return new Response(JSON.stringify(data), { status, headers });
}

function textResponse(
  request: Request,
  env: Env,
  status: number,
  message: string
): Response {
  const origin = resolveCorsOrigin(request, env);
  const headers = new Headers({
    'Content-Type': 'text/plain',
    ...buildCorsHeaders(origin),
    ...buildSecurityHeaders(),
  });
  return new Response(message, { status, headers });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function requireJsonContentType(request: Request): boolean {
  const contentType = request.headers.get('Content-Type') || '';
  return contentType.includes('application/json');
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{2,20}$/.test(username);
}

async function getAuthUser(request: Request, env: Env): Promise<DecodedToken | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const config = getFirebaseConfig(env);

  try {
    return await verifyIdToken(token, config.projectId);
  } catch {
    return null;
  }
}

function enforceRateLimit(
  request: Request,
  bucket: string,
  limit: number
): boolean {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();

  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // New window
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}

function parseRateLimit(env: Env): number {
  const value = env.RATE_LIMIT_PER_MINUTE;
  if (!value) {
    return 120;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function validateGamePayload(body: SubmitGameRequest): string | null {
  if (!Number.isFinite(body.wpm) || body.wpm < 0 || body.wpm > 400) {
    return 'Invalid wpm';
  }
  if (!Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > 100) {
    return 'Invalid accuracy';
  }
  if (body.time !== undefined && (!Number.isFinite(body.time) || body.time < 0)) {
    return 'Invalid time';
  }
  if (body.characters !== undefined && (!Number.isFinite(body.characters) || body.characters < 0)) {
    return 'Invalid characters';
  }
  if (body.errors !== undefined && (!Number.isFinite(body.errors) || body.errors < 0)) {
    return 'Invalid errors';
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const origin = resolveCorsOrigin(request, env);
    if (request.method === 'OPTIONS') {
      if (!origin) {
        return textResponse(request, env, 403, 'Origin not allowed');
      }
      return new Response(null, { headers: buildCorsHeaders(origin) });
    }

    if (!origin) {
      return textResponse(request, env, 403, 'Origin not allowed');
    }

    const rateLimit = parseRateLimit(env);
    const config = getFirebaseConfig(env);

    try {
      if (path === '/auth/verify' && request.method === 'POST') {
        if (!requireJsonContentType(request)) {
          return jsonResponse(request, env, { error: 'Expected JSON body' }, 415);
        }

        const allowed = enforceRateLimit(request, 'auth-verify', rateLimit);
        if (!allowed) {
          return jsonResponse(request, env, { error: 'Too many requests' }, 429);
        }

        const body = await readJson<VerifyTokenRequest>(request);
        if (!body?.idToken) {
          return jsonResponse(request, env, { error: 'Missing idToken' }, 400);
        }

        try {
          const decoded = await verifyIdToken(body.idToken, config.projectId);

          const user = await firestoreGet<UserDocument>(env, 'users', decoded.uid);
          const response: VerifyTokenResponse = {
            valid: true,
            user: user || undefined,
            needsUsername: !user?.username,
          };

          return jsonResponse(request, env, response);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('Token verification failed:', message);
          return jsonResponse(request, env, { valid: false, reason: message }, 401);
        }
      }

      if (path === '/auth/register' && request.method === 'POST') {
        if (!requireJsonContentType(request)) {
          return jsonResponse(request, env, { error: 'Expected JSON body' }, 415);
        }

        const allowed = enforceRateLimit(request, 'auth-register', rateLimit);
        if (!allowed) {
          return jsonResponse(request, env, { error: 'Too many requests' }, 429);
        }

        const authUser = await getAuthUser(request, env);
        if (!authUser) {
          return jsonResponse(request, env, { error: 'Unauthorized' }, 401);
        }

        const body = await readJson<RegisterRequest>(request);
        if (!body?.username) {
          return jsonResponse(request, env, { error: 'Missing username' }, 400);
        }

        const normalized = normalizeUsername(body.username);
        if (!isValidUsername(normalized)) {
          return jsonResponse(
            request,
            env,
            { error: 'Invalid username format (2-20 chars, alphanumeric, underscore, hyphen)' },
            400
          );
        }

        const available = await isUsernameAvailable(env, normalized);
        const existingUser = await firestoreGet<UserDocument>(env, 'users', authUser.uid);

        if (!available && existingUser?.username !== normalized) {
          return jsonResponse(request, env, { error: 'Username already taken' }, 409);
        }

        const now = Date.now();
        const userData: UserDocument = existingUser
          ? {
              ...existingUser,
              username: normalized,
              displayName: authUser.name || normalized,
              lastLoginAt: now,
            }
          : {
              uid: authUser.uid,
              email: authUser.email,
              displayName: authUser.name || normalized,
              username: normalized,
              photoURL: authUser.picture,
              createdAt: now,
              lastLoginAt: now,
              totalGamesPlayed: 0,
              totalWpm: 0,
              bestWpm: 0,
              avgWpm: 0,
              totalCharacters: 0,
              totalErrors: 0,
              currentStreak: 0,
              longestStreak: 0,
              lastPlayedDate: '',
            };

        await firestoreSet(env, 'users', authUser.uid, userData);
        return jsonResponse(request, env, { success: true, user: userData });
      }

      const statsMatch = path.match(/^\/users\/([^/]+)\/stats$/);
      if (statsMatch && request.method === 'GET') {
        const uid = statsMatch[1];
        const authUser = await getAuthUser(request, env);
        if (!authUser || authUser.uid !== uid) {
          return jsonResponse(request, env, { error: 'Unauthorized' }, 401);
        }

        const user = await firestoreGet<UserDocument>(env, 'users', uid);
        if (!user) {
          return jsonResponse(request, env, { error: 'User not found' }, 404);
        }

        const recentGames = await firestoreQuery<GameDocument>(
          env,
          'games',
          [{ field: 'userId', op: 'EQUAL', value: uid }],
          { field: 'playedAt', direction: 'DESCENDING' },
          20
        );

        const response: UserStatsResponse = {
          user,
          recentGames,
        };

        return jsonResponse(request, env, response);
      }

      const streaksMatch = path.match(/^\/users\/([^/]+)\/streaks$/);
      if (streaksMatch && request.method === 'GET') {
        const uid = streaksMatch[1];
        const authUser = await getAuthUser(request, env);
        if (!authUser || authUser.uid !== uid) {
          return jsonResponse(request, env, { error: 'Unauthorized' }, 401);
        }

        const year = parseInt(
          url.searchParams.get('year') || new Date().getFullYear().toString(),
          10
        );

        const user = await firestoreGet<UserDocument>(env, 'users', uid);
        if (!user) {
          return jsonResponse(request, env, { error: 'User not found' }, 404);
        }

        const activities = await getYearActivity(env, uid, year);
        const activitiesMap: Record<
          string,
          { gamesPlayed: number; totalWpm: number; bestWpm: number }
        > = {};
        for (const [date, activity] of Object.entries(activities)) {
          activitiesMap[date] = {
            gamesPlayed: activity.gamesPlayed,
            totalWpm: activity.totalWpm,
            bestWpm: activity.bestWpm,
          };
        }

        const response: StreaksResponse = {
          activities: activitiesMap,
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          totalActiveDays: Object.keys(activities).length,
        };

        return jsonResponse(request, env, response);
      }

      if (path === '/games' && request.method === 'POST') {
        if (!requireJsonContentType(request)) {
          return jsonResponse(request, env, { error: 'Expected JSON body' }, 415);
        }

        const allowed = enforceRateLimit(request, 'games', rateLimit);
        if (!allowed) {
          return jsonResponse(request, env, { error: 'Too many requests' }, 429);
        }

        const authUser = await getAuthUser(request, env);
        if (!authUser) {
          return jsonResponse(request, env, { error: 'Unauthorized' }, 401);
        }

        const body = await readJson<SubmitGameRequest>(request);
        if (!body) {
          return jsonResponse(request, env, { error: 'Invalid JSON body' }, 400);
        }

        const validationError = validateGamePayload(body);
        if (validationError) {
          return jsonResponse(request, env, { error: validationError }, 400);
        }

        const today = getTodayDate();
        const user = await firestoreGet<UserDocument>(env, 'users', authUser.uid);
        if (!user) {
          return jsonResponse(request, env, { error: 'User not registered' }, 400);
        }

        const gameData: Omit<GameDocument, 'id'> = {
          userId: authUser.uid,
          wpm: body.wpm,
          accuracy: body.accuracy,
          time: body.time || 0,
          characters: body.characters || 0,
          errors: body.errors || 0,
          language: body.language,
          playedAt: Date.now(),
          date: today,
        };

        const gameId = await firestoreAdd(env, 'games', gameData);

        const newTotalGames = user.totalGamesPlayed + 1;
        const newTotalWpm = user.totalWpm + body.wpm;
        const newBestWpm = Math.max(user.bestWpm, body.wpm);
        const newAvgWpm = Math.round(newTotalWpm / newTotalGames);

        await firestoreSet(env, 'users', authUser.uid, {
          ...user,
          totalGamesPlayed: newTotalGames,
          totalWpm: newTotalWpm,
          bestWpm: newBestWpm,
          avgWpm: newAvgWpm,
          totalCharacters: user.totalCharacters + (body.characters || 0),
          totalErrors: user.totalErrors + (body.errors || 0),
        });

        const { currentStreak } = await updateStreak(env, authUser.uid, today);
        await updateActivity(env, authUser.uid, today, body.wpm);

        const response: SubmitGameResponse = {
          success: true,
          gameId,
          updatedStats: {
            totalGamesPlayed: newTotalGames,
            avgWpm: newAvgWpm,
            bestWpm: newBestWpm,
            currentStreak,
          },
        };

        return jsonResponse(request, env, response);
      }

      if (path === '/rooms' && request.method === 'POST') {
        if (!requireJsonContentType(request)) {
          return jsonResponse(request, env, { error: 'Expected JSON body' }, 415);
        }

        const allowed = enforceRateLimit(request, 'rooms', rateLimit);
        if (!allowed) {
          return jsonResponse(request, env, { error: 'Too many requests' }, 429);
        }

        const body = await readJson<any>(request);
        const { hostId, hostUsername } = body || {};

        if (!hostId || !hostUsername) {
          return jsonResponse(request, env, { error: 'Missing host info' }, 400);
        }

        let roomCode = generateRoomCode();
        let attempts = 0;
        while ((await isRoomCodeTaken(env, roomCode)) && attempts < 10) {
          roomCode = generateRoomCode();
          attempts++;
        }

        const roomData: RoomDocument = {
          code: roomCode,
          hostId,
          hostUsername,
          createdAt: Date.now(),
          expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
        };

        await createRoom(env, roomData);

        return jsonResponse(request, env, { code: roomCode });
      }

      const roomMatch = path.match(/^\/rooms\/([A-Z0-9]+)\/ws$/);
      if (roomMatch) {
        const roomCode = roomMatch[1];
        const userId = url.searchParams.get('userId');
        const username = url.searchParams.get('username');

        if (!userId || !username) {
          return jsonResponse(request, env, { error: 'Missing user info' }, 400);
        }

        const id = env.ROOMS.idFromName(roomCode);
        const room = env.ROOMS.get(id);

        const newUrl = new URL(request.url);
        newUrl.pathname = '/websocket';
        const newRequest = new Request(newUrl.toString(), request);

        return room.fetch(newRequest);
      }

      return jsonResponse(request, env, { error: 'Not found' }, 404);
    } catch {
      return jsonResponse(request, env, { error: 'Internal server error' }, 500);
    }
  },
};

export class GameRoom {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { userId: string; username: string }> = new Map();
  private players: Map<
    string,
    {
      username: string;
      progress: number;
      wpm: number;
      finished: boolean;
      finishTime?: number;
    }
  > = new Map();
  private hostId = '';
  private gameStatus: 'waiting' | 'countdown' | 'playing' | 'finished' = 'waiting';
  private codeSnippet = '';
  private gameStartTime = 0;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/websocket') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected websocket', { status: 400 });
      }

      const userId = url.searchParams.get('userId')!;
      const username = decodeURIComponent(url.searchParams.get('username')!);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.handleSession(server, userId, username);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  private handleSession(ws: WebSocket, userId: string, username: string) {
    (ws as any).accept();

    if (this.players.size === 0) {
      this.hostId = userId;
    }

    this.sessions.set(ws, { userId, username });
    this.players.set(userId, {
      username,
      progress: 0,
      wpm: 0,
      finished: false,
    });

    this.sendToOne(ws, 'joined', {
      isHost: userId === this.hostId,
      players: this.getPlayersList(),
      status: this.gameStatus,
    });

    this.broadcast('playerJoined', {
      players: this.getPlayersList(),
    });

    ws.addEventListener('message', async (event) => {
      try {
        const message = JSON.parse(event.data as string);
        await this.handleMessage(ws, userId, message);
      } catch {
        // Ignore malformed events
      }
    });

    ws.addEventListener('close', () => {
      this.sessions.delete(ws);
      this.players.delete(userId);

      if (userId === this.hostId && this.players.size > 0) {
        this.hostId = this.players.keys().next().value;
      }

      this.broadcast('playerLeft', {
        players: this.getPlayersList(),
      });
    });
  }

  private async handleMessage(ws: WebSocket, userId: string, message: any) {
    switch (message.type) {
      case 'start':
        if (userId === this.hostId && this.gameStatus === 'waiting') {
          this.codeSnippet = message.data.codeSnippet;
          this.gameStatus = 'countdown';

          for (let i = 3; i >= 1; i--) {
            this.broadcast('countdown', { count: i });
            await this.sleep(1000);
          }

          this.gameStatus = 'playing';
          this.gameStartTime = Date.now();

          this.broadcast('gameStart', {
            codeSnippet: this.codeSnippet,
            startTime: this.gameStartTime,
          });
        }
        break;

      case 'progress':
        const player = this.players.get(userId);
        if (player && this.gameStatus === 'playing') {
          player.progress = message.data.progress;
          player.wpm = message.data.wpm;

          this.broadcast('progress', {
            players: this.getPlayersList(),
          });
        }
        break;

      case 'finish':
        const finishingPlayer = this.players.get(userId);
        if (finishingPlayer && this.gameStatus === 'playing') {
          finishingPlayer.finished = true;
          finishingPlayer.finishTime = Date.now() - this.gameStartTime;
          finishingPlayer.progress = 100;
          finishingPlayer.wpm = message.data.wpm;

          this.broadcast('playerFinished', {
            userId,
            username: finishingPlayer.username,
            wpm: message.data.wpm,
            time: finishingPlayer.finishTime,
          });

          const allFinished = Array.from(this.players.values()).every((p) => p.finished);
          if (allFinished) {
            this.gameStatus = 'finished';
            this.broadcast('gameEnd', {
              results: this.getResults(),
            });

            await this.sleep(5000);
            this.resetGame();
          }
        }
        break;
    }
  }

  private getPlayersList() {
    return Array.from(this.players.entries()).map(([id, p]) => ({
      userId: id,
      username: p.username,
      progress: p.progress,
      wpm: p.wpm,
      finished: p.finished,
      isHost: id === this.hostId,
    }));
  }

  private getResults() {
    return Array.from(this.players.entries())
      .map(([id, p]) => ({
        userId: id,
        username: p.username,
        wpm: p.wpm,
        time: p.finishTime,
      }))
      .sort((a, b) => (b.wpm || 0) - (a.wpm || 0));
  }

  private resetGame() {
    this.gameStatus = 'waiting';
    this.codeSnippet = '';
    this.gameStartTime = 0;

    for (const player of this.players.values()) {
      player.progress = 0;
      player.wpm = 0;
      player.finished = false;
      player.finishTime = undefined;
    }

    this.broadcast('reset', {
      players: this.getPlayersList(),
    });
  }

  private sendToOne(ws: WebSocket, type: string, data: any) {
    ws.send(JSON.stringify({ type, data }));
  }

  private broadcast(type: string, data: any) {
    const message = JSON.stringify({ type, data });
    for (const socket of this.sessions.keys()) {
      try {
        socket.send(message);
      } catch {
        // Ignore closed sockets
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
