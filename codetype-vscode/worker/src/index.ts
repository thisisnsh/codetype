export interface Env {
  ROOMS: DurableObjectNamespace;
  CODETYPE_KV: KVNamespace;
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Generate a random room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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

    try {
      // Route: POST /scores - Submit a game score
      if (path === '/scores' && request.method === 'POST') {
        const body = await request.json() as any;
        const { userId, username, wpm, accuracy, time, characters, errors } = body;

        if (!userId || !username || wpm === undefined) {
          return jsonResponse({ error: 'Missing required fields' }, 400);
        }

        // Store the score
        const scoreKey = `score:${userId}:${Date.now()}`;
        await env.CODETYPE_KV.put(scoreKey, JSON.stringify({
          userId,
          username,
          wpm,
          accuracy,
          time,
          characters,
          errors,
          timestamp: Date.now()
        }), { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days

        // Update user stats
        const userStatsKey = `user:${userId}`;
        const existingStats = await env.CODETYPE_KV.get(userStatsKey);
        const stats = existingStats ? JSON.parse(existingStats) : {
          username,
          totalGames: 0,
          totalWpm: 0,
          bestWpm: 0
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

      // Route: POST /rooms - Create a new room
      if (path === '/rooms' && request.method === 'POST') {
        const body = await request.json() as any;
        const { hostId, hostUsername } = body;

        if (!hostId || !hostUsername) {
          return jsonResponse({ error: 'Missing host info' }, 400);
        }

        // Generate unique room code
        let roomCode = generateRoomCode();
        let attempts = 0;
        while (await env.CODETYPE_KV.get(`room:${roomCode}`) && attempts < 10) {
          roomCode = generateRoomCode();
          attempts++;
        }

        // Store room info
        await env.CODETYPE_KV.put(`room:${roomCode}`, JSON.stringify({
          code: roomCode,
          hostId,
          hostUsername,
          createdAt: Date.now()
        }), { expirationTtl: 60 * 60 * 2 }); // 2 hours

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

        // Get or create Durable Object for this room
        const id = env.ROOMS.idFromName(roomCode);
        const room = env.ROOMS.get(id);

        // Forward the request to the Durable Object
        const newUrl = new URL(request.url);
        newUrl.pathname = '/websocket';
        const newRequest = new Request(newUrl.toString(), request);

        return room.fetch(newRequest);
      }

      // 404 for unknown routes
      return jsonResponse({ error: 'Not found' }, 404);

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  }
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

async function updateLeaderboards(env: Env, userId: string, username: string, wpm: number) {
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];
  const weekStart = getWeekStart();

  // Daily leaderboard
  await updateLeaderboardEntry(env, `leaderboard:daily:${today}`, userId, username, wpm, 60 * 60 * 48);

  // Weekly leaderboard
  await updateLeaderboardEntry(env, `leaderboard:weekly:${weekStart}`, userId, username, wpm, 60 * 60 * 24 * 8);

  // All-time leaderboard (persistent)
  await updateLeaderboardEntry(env, 'leaderboard:alltime', userId, username, wpm);
}

async function updateLeaderboardEntry(
  env: Env,
  key: string,
  userId: string,
  username: string,
  wpm: number,
  expirationTtl?: number
) {
  const existing = await env.CODETYPE_KV.get(key);
  const leaderboard: Record<string, { username: string; scores: number[]; avgWpm: number; bestWpm: number }> =
    existing ? JSON.parse(existing) : {};

  if (!leaderboard[userId]) {
    leaderboard[userId] = { username, scores: [], avgWpm: 0, bestWpm: 0 };
  }

  leaderboard[userId].username = username;
  leaderboard[userId].scores.push(wpm);
  leaderboard[userId].bestWpm = Math.max(leaderboard[userId].bestWpm, wpm);
  leaderboard[userId].avgWpm = Math.round(
    leaderboard[userId].scores.reduce((a, b) => a + b, 0) / leaderboard[userId].scores.length
  );

  const options: KVNamespacePutOptions = expirationTtl ? { expirationTtl } : {};
  await env.CODETYPE_KV.put(key, JSON.stringify(leaderboard), options);
}

async function getLeaderboard(env: Env, timeframe: string): Promise<any[]> {
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
    .map(([userId, entry]: [string, any]) => ({
      userId,
      username: entry.username,
      avgWpm: entry.avgWpm,
      bestWpm: entry.bestWpm,
      gamesPlayed: entry.scores.length
    }))
    .sort((a, b) => b.avgWpm - a.avgWpm)
    .slice(0, 100);
}

function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// Durable Object for managing game rooms
export class GameRoom {
  private state: DurableObjectState;
  private sessions: Map<WebSocket, { userId: string; username: string }> = new Map();
  private players: Map<string, {
    username: string;
    progress: number;
    wpm: number;
    finished: boolean;
    finishTime?: number;
  }> = new Map();
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

      // Handle WebSocket
      this.handleSession(server, userId, username);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response('Not found', { status: 404 });
  }

  private handleSession(ws: WebSocket, userId: string, username: string) {
    (ws as any).accept();

    // First player becomes host
    if (this.players.size === 0) {
      this.hostId = userId;
    }

    this.sessions.set(ws, { userId, username });
    this.players.set(userId, {
      username,
      progress: 0,
      wpm: 0,
      finished: false
    });

    // Send current state to new player
    this.sendToOne(ws, 'joined', {
      isHost: userId === this.hostId,
      players: this.getPlayersList(),
      status: this.gameStatus
    });

    // Notify others
    this.broadcast('playerJoined', {
      players: this.getPlayersList()
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

      // If host left, assign new host
      if (userId === this.hostId && this.players.size > 0) {
        this.hostId = this.players.keys().next().value;
      }

      this.broadcast('playerLeft', {
        players: this.getPlayersList()
      });
    });
  }

  private async handleMessage(ws: WebSocket, userId: string, message: any) {
    switch (message.type) {
      case 'start':
        if (userId === this.hostId && this.gameStatus === 'waiting') {
          this.codeSnippet = message.data.codeSnippet;
          this.gameStatus = 'countdown';

          // Countdown
          for (let i = 3; i >= 1; i--) {
            this.broadcast('countdown', { count: i });
            await this.sleep(1000);
          }

          this.gameStatus = 'playing';
          this.gameStartTime = Date.now();

          this.broadcast('gameStart', {
            codeSnippet: this.codeSnippet,
            startTime: this.gameStartTime
          });
        }
        break;

      case 'progress':
        const player = this.players.get(userId);
        if (player && this.gameStatus === 'playing') {
          player.progress = message.data.progress;
          player.wpm = message.data.wpm;

          this.broadcast('progress', {
            players: this.getPlayersList()
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
            time: finishingPlayer.finishTime
          });

          // Check if all players finished
          const allFinished = Array.from(this.players.values()).every(p => p.finished);
          if (allFinished) {
            this.gameStatus = 'finished';
            this.broadcast('gameEnd', {
              results: this.getResults()
            });

            // Reset for next game after 5 seconds
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
      isHost: id === this.hostId
    }));
  }

  private getResults() {
    return Array.from(this.players.entries())
      .map(([id, p]) => ({
        userId: id,
        username: p.username,
        wpm: p.wpm,
        time: p.finishTime
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
      players: this.getPlayersList()
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
