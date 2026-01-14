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
  LeaderboardEntry,
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
} from './firebase';

// Re-export Env for wrangler
export type { Env };

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Generate a random room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Extract and verify auth token from request
async function getAuthUser(
  request: Request,
  env: Env
): Promise<DecodedToken | null> {
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

// JSON response helper
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Main worker
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const config = getFirebaseConfig(env);

    try {
      // ==================== AUTH ROUTES ====================

      // Route: POST /auth/verify - Verify Firebase ID token
      if (path === '/auth/verify' && request.method === 'POST') {
        const body = (await request.json()) as VerifyTokenRequest;

        if (!body.idToken) {
          return jsonResponse({ error: 'Missing idToken' }, 400);
        }

        try {
          const decoded = await verifyIdToken(body.idToken, config.projectId);

          // Check if user exists in Firestore
          const user = await firestoreGet<UserDocument>(
            config.projectId,
            config.apiKey,
            'users',
            decoded.uid
          );

          const response: VerifyTokenResponse = {
            valid: true,
            user: user || undefined,
            needsUsername: !user?.username,
          };

          return jsonResponse(response);
        } catch (error: any) {
          return jsonResponse(
            { valid: false, error: error.message },
            401
          );
        }
      }

      // Route: POST /auth/register - Create/update user profile
      if (path === '/auth/register' && request.method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = (await request.json()) as RegisterRequest;

        if (!body.username) {
          return jsonResponse({ error: 'Missing username' }, 400);
        }

        // Validate username format
        const usernameRegex = /^[a-zA-Z0-9_-]{2,20}$/;
        if (!usernameRegex.test(body.username)) {
          return jsonResponse(
            { error: 'Invalid username format (2-20 chars, alphanumeric, underscore, hyphen)' },
            400
          );
        }

        // Check if username is available
        const available = await isUsernameAvailable(
          config.projectId,
          config.apiKey,
          body.username
        );

        // Get existing user to check if they're updating their own username
        const existingUser = await firestoreGet<UserDocument>(
          config.projectId,
          config.apiKey,
          'users',
          authUser.uid
        );

        if (!available && existingUser?.username !== body.username.toLowerCase()) {
          return jsonResponse({ error: 'Username already taken' }, 409);
        }

        const now = Date.now();
        const userData: UserDocument = existingUser
          ? {
              ...existingUser,
              username: body.username.toLowerCase(),
              displayName: authUser.name || body.username,
              lastLoginAt: now,
            }
          : {
              uid: authUser.uid,
              email: authUser.email,
              displayName: authUser.name || body.username,
              username: body.username.toLowerCase(),
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

        await firestoreSet(config.projectId, config.apiKey, 'users', authUser.uid, userData);

        return jsonResponse({ success: true, user: userData });
      }

      // ==================== USER ROUTES ====================

      // Route: GET /users/:uid/stats - Get user statistics
      const statsMatch = path.match(/^\/users\/([^/]+)\/stats$/);
      if (statsMatch && request.method === 'GET') {
        const uid = statsMatch[1];

        const user = await firestoreGet<UserDocument>(
          config.projectId,
          config.apiKey,
          'users',
          uid
        );

        if (!user) {
          return jsonResponse({ error: 'User not found' }, 404);
        }

        // Get recent games
        const recentGames = await firestoreQuery<GameDocument>(
          config.projectId,
          config.apiKey,
          'games',
          [{ field: 'userId', op: 'EQUAL', value: uid }],
          { field: 'playedAt', direction: 'DESCENDING' },
          20
        );

        const response: UserStatsResponse = {
          user,
          recentGames,
        };

        return jsonResponse(response);
      }

      // Route: GET /users/:uid/streaks - Get streak data for heatmap
      const streaksMatch = path.match(/^\/users\/([^/]+)\/streaks$/);
      if (streaksMatch && request.method === 'GET') {
        const uid = streaksMatch[1];
        const year = parseInt(url.searchParams.get('year') || new Date().getFullYear().toString(), 10);

        const user = await firestoreGet<UserDocument>(
          config.projectId,
          config.apiKey,
          'users',
          uid
        );

        if (!user) {
          return jsonResponse({ error: 'User not found' }, 404);
        }

        const activities = await getYearActivity(config.projectId, config.apiKey, uid, year);

        // Transform activities for response
        const activitiesMap: Record<string, { gamesPlayed: number; totalWpm: number; bestWpm: number }> = {};
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

        return jsonResponse(response);
      }

      // ==================== GAME ROUTES ====================

      // Route: POST /games - Submit game result (authenticated)
      if (path === '/games' && request.method === 'POST') {
        const authUser = await getAuthUser(request, env);
        if (!authUser) {
          return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        const body = (await request.json()) as SubmitGameRequest;

        if (body.wpm === undefined || body.accuracy === undefined) {
          return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        const config = getFirebaseConfig(env);
        const today = getTodayDate();

        // Get user
        const user = await firestoreGet<UserDocument>(
          config.projectId,
          config.apiKey,
          'users',
          authUser.uid
        );

        if (!user) {
          return jsonResponse({ error: 'User not registered' }, 400);
        }

        // Create game document
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

        const gameId = await firestoreAdd(config.projectId, config.apiKey, 'games', gameData);

        // Update user stats
        const newTotalGames = user.totalGamesPlayed + 1;
        const newTotalWpm = user.totalWpm + body.wpm;
        const newBestWpm = Math.max(user.bestWpm, body.wpm);
        const newAvgWpm = Math.round(newTotalWpm / newTotalGames);

        await firestoreSet(config.projectId, config.apiKey, 'users', authUser.uid, {
          ...user,
          totalGamesPlayed: newTotalGames,
          totalWpm: newTotalWpm,
          bestWpm: newBestWpm,
          avgWpm: newAvgWpm,
          totalCharacters: user.totalCharacters + (body.characters || 0),
          totalErrors: user.totalErrors + (body.errors || 0),
        });

        // Update streak
        const { currentStreak } = await updateStreak(
          config.projectId,
          config.apiKey,
          authUser.uid,
          today
        );

        // Update activity for heatmap
        await updateActivity(config.projectId, config.apiKey, authUser.uid, today, body.wpm);

        // Also update KV-based leaderboard for backwards compatibility
        await updateLeaderboards(env, authUser.uid, user.username, body.wpm, user.photoURL);

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

        return jsonResponse(response);
      }

      // ==================== LEGACY ROUTES (anonymous support) ====================

      // Route: POST /scores - Submit a game score (anonymous)
      if (path === '/scores' && request.method === 'POST') {
        const body = (await request.json()) as any;
        const { userId, username, wpm, accuracy, time, characters, errors } = body;

        if (!userId || !username || wpm === undefined) {
          return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        // Store the score in KV
        const scoreKey = `score:${userId}:${Date.now()}`;
        await env.CODETYPE_KV.put(
          scoreKey,
          JSON.stringify({
            userId,
            username,
            wpm,
            accuracy,
            time,
            characters,
            errors,
            timestamp: Date.now(),
          }),
          { expirationTtl: 60 * 60 * 24 * 90 }
        );

        // Update user stats in KV
        const userStatsKey = `user:${userId}`;
        const existingStats = await env.CODETYPE_KV.get(userStatsKey);
        const stats = existingStats
          ? JSON.parse(existingStats)
          : {
              username,
              totalGames: 0,
              totalWpm: 0,
              bestWpm: 0,
            };

        stats.username = username;
        stats.totalGames++;
        stats.totalWpm += wpm;
        stats.bestWpm = Math.max(stats.bestWpm, wpm);
        stats.lastPlayed = Date.now();

        await env.CODETYPE_KV.put(userStatsKey, JSON.stringify(stats));

        // Update leaderboard entries
        await updateLeaderboards(env, userId, username, wpm);

        return jsonResponse({ success: true });
      }

      // Route: GET /leaderboard - Get leaderboard
      if (path === '/leaderboard' && request.method === 'GET') {
        const timeframe = url.searchParams.get('timeframe') || 'weekly';
        const leaderboard = await getLeaderboard(env, timeframe);
        return jsonResponse(leaderboard);
      }

      // ==================== ROOM ROUTES (multiplayer - kept for future) ====================

      // Route: POST /rooms - Create a new room
      if (path === '/rooms' && request.method === 'POST') {
        const body = (await request.json()) as any;
        const { hostId, hostUsername } = body;

        if (!hostId || !hostUsername) {
          return jsonResponse({ error: 'Missing host info' }, 400);
        }

        let roomCode = generateRoomCode();
        let attempts = 0;
        while ((await env.CODETYPE_KV.get(`room:${roomCode}`)) && attempts < 10) {
          roomCode = generateRoomCode();
          attempts++;
        }

        await env.CODETYPE_KV.put(
          `room:${roomCode}`,
          JSON.stringify({
            code: roomCode,
            hostId,
            hostUsername,
            createdAt: Date.now(),
          }),
          { expirationTtl: 60 * 60 * 2 }
        );

        return jsonResponse({ code: roomCode });
      }

      // Route: WebSocket /rooms/:code/ws - Join room via WebSocket
      const roomMatch = path.match(/^\/rooms\/([A-Z0-9]+)\/ws$/);
      if (roomMatch) {
        const roomCode = roomMatch[1];
        const userId = url.searchParams.get('userId');
        const username = url.searchParams.get('username');

        if (!userId || !username) {
          return jsonResponse({ error: 'Missing user info' }, 400);
        }

        const id = env.ROOMS.idFromName(roomCode);
        const room = env.ROOMS.get(id);

        const newUrl = new URL(request.url);
        newUrl.pathname = '/websocket';
        const newRequest = new Request(newUrl.toString(), request);

        return room.fetch(newRequest);
      }

      // 404 for unknown routes
      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error: any) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error', details: error.message }, 500);
    }
  },
};

// ==================== LEADERBOARD HELPERS ====================

async function updateLeaderboards(
  env: Env,
  userId: string,
  username: string,
  wpm: number,
  photoURL?: string
) {
  const today = new Date().toISOString().split('T')[0];
  const weekStart = getWeekStart();

  // Daily leaderboard
  await updateLeaderboardEntry(
    env,
    `leaderboard:daily:${today}`,
    userId,
    username,
    wpm,
    photoURL,
    60 * 60 * 48
  );

  // Weekly leaderboard
  await updateLeaderboardEntry(
    env,
    `leaderboard:weekly:${weekStart}`,
    userId,
    username,
    wpm,
    photoURL,
    60 * 60 * 24 * 8
  );

  // All-time leaderboard
  await updateLeaderboardEntry(env, 'leaderboard:alltime', userId, username, wpm, photoURL);
}

async function updateLeaderboardEntry(
  env: Env,
  key: string,
  userId: string,
  username: string,
  wpm: number,
  photoURL?: string,
  expirationTtl?: number
) {
  const existing = await env.CODETYPE_KV.get(key);
  const leaderboard: Record<
    string,
    { username: string; scores: number[]; avgWpm: number; bestWpm: number; photoURL?: string }
  > = existing ? JSON.parse(existing) : {};

  if (!leaderboard[userId]) {
    leaderboard[userId] = { username, scores: [], avgWpm: 0, bestWpm: 0 };
  }

  leaderboard[userId].username = username;
  leaderboard[userId].scores.push(wpm);
  leaderboard[userId].bestWpm = Math.max(leaderboard[userId].bestWpm, wpm);
  leaderboard[userId].avgWpm = Math.round(
    leaderboard[userId].scores.reduce((a, b) => a + b, 0) / leaderboard[userId].scores.length
  );
  if (photoURL) {
    leaderboard[userId].photoURL = photoURL;
  }

  const options: KVNamespacePutOptions = expirationTtl ? { expirationTtl } : {};
  await env.CODETYPE_KV.put(key, JSON.stringify(leaderboard), options);
}

async function getLeaderboard(env: Env, timeframe: string): Promise<LeaderboardEntry[]> {
  let key: string;

  switch (timeframe) {
    case 'daily':
      key = `leaderboard:daily:${new Date().toISOString().split('T')[0]}`;
      break;
    case 'weekly':
      key = `leaderboard:weekly:${getWeekStart()}`;
      break;
    default:
      key = 'leaderboard:alltime';
  }

  const data = await env.CODETYPE_KV.get(key);
  if (!data) return [];

  const leaderboard = JSON.parse(data);
  return Object.entries(leaderboard)
    .map(([userId, entry]: [string, any], index) => ({
      rank: index + 1,
      userId,
      username: entry.username,
      photoURL: entry.photoURL,
      avgWpm: entry.avgWpm,
      bestWpm: entry.bestWpm,
      gamesPlayed: entry.scores.length,
    }))
    .sort((a, b) => b.avgWpm - a.avgWpm)
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
    .slice(0, 100);
}

function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// ==================== DURABLE OBJECT ====================

// Durable Object for managing game rooms
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
  private hostId: string = '';
  private gameStatus: 'waiting' | 'countdown' | 'playing' | 'finished' = 'waiting';
  private codeSnippet: string = '';
  private gameStartTime: number = 0;

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
      } catch (e) {
        console.error('Message handling error:', e);
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
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(message);
      } catch (e) {
        // Connection might be closed
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
