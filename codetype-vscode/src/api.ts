import * as vscode from 'vscode';

// Configure your Cloudflare Worker URL here after deployment
// For development/offline mode, leave as empty string - solo mode will work locally
const API_BASE = process.env.CODETYPE_API_URL || '';

// Set to true to enable offline-only mode (no backend required for solo play)
const OFFLINE_MODE = !API_BASE;

export interface LeaderboardEntry {
    rank: number;
    username: string;
    avgWpm: number;
    gamesPlayed: number;
    bestWpm: number;
}

export interface RoomInfo {
    code: string;
    hostId: string;
    hostUsername: string;
    players: PlayerInfo[];
    status: 'waiting' | 'countdown' | 'playing' | 'finished';
    codeSnippet?: string;
    startTime?: number;
}

export interface PlayerInfo {
    id: string;
    username: string;
    progress: number;
    wpm: number;
    finished: boolean;
    finishTime?: number;
}

export interface GameResult {
    wpm: number;
    accuracy: number;
    time: number;
    characters: number;
    errors: number;
}

export class ApiClient {
    private context: vscode.ExtensionContext;
    private ws: WebSocket | null = null;
    private messageHandlers: Map<string, (data: any) => void> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private getConfig() {
        const config = vscode.workspace.getConfiguration('codetype');
        return {
            userId: config.get<string>('userId') || '',
            username: config.get<string>('username') || 'Anonymous'
        };
    }

    async submitScore(result: GameResult): Promise<void> {
        // Always store locally first
        this.storeLocalScore(result);

        // If online mode, also submit to server
        if (!OFFLINE_MODE) {
            const { userId, username } = this.getConfig();
            try {
                const response = await fetch(`${API_BASE}/scores`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        username,
                        ...result
                    })
                });

                if (!response.ok) {
                    console.warn('Failed to submit score to server, stored locally');
                }
            } catch (error) {
                console.warn('Failed to submit score to server:', error);
            }
        }
    }

    private storeLocalScore(result: GameResult) {
        const stats = this.context.globalState.get<any>('localStats') || {
            games: [],
            totalWpm: 0,
            bestWpm: 0,
            gamesPlayed: 0
        };

        stats.games.push({ ...result, timestamp: Date.now() });
        stats.totalWpm += result.wpm;
        stats.bestWpm = Math.max(stats.bestWpm, result.wpm);
        stats.gamesPlayed++;

        this.context.globalState.update('localStats', stats);
    }

    getLocalStats() {
        return this.context.globalState.get<any>('localStats') || {
            games: [],
            totalWpm: 0,
            bestWpm: 0,
            gamesPlayed: 0
        };
    }

    async getLeaderboard(timeframe: 'daily' | 'weekly' | 'alltime' = 'weekly'): Promise<LeaderboardEntry[]> {
        if (OFFLINE_MODE) {
            // Return local leaderboard based on user's own stats
            const stats = this.getLocalStats();
            if (stats.gamesPlayed === 0) return [];

            const { username } = this.getConfig();
            return [{
                rank: 1,
                username: username || 'You',
                avgWpm: Math.round(stats.totalWpm / stats.gamesPlayed),
                gamesPlayed: stats.gamesPlayed,
                bestWpm: stats.bestWpm
            }];
        }

        try {
            const response = await fetch(`${API_BASE}/leaderboard?timeframe=${timeframe}`);
            if (!response.ok) throw new Error('Failed to fetch leaderboard');
            return await response.json() as LeaderboardEntry[];
        } catch (error) {
            console.error('Failed to fetch leaderboard:', error);
            return [];
        }
    }

    async createRoom(): Promise<string> {
        if (OFFLINE_MODE) {
            throw new Error('Multiplayer requires backend. Deploy the Cloudflare Worker first!');
        }

        const { userId, username } = this.getConfig();

        try {
            const response = await fetch(`${API_BASE}/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostId: userId, hostUsername: username })
            });

            if (!response.ok) throw new Error('Failed to create room');
            const data = await response.json() as { code: string };
            return data.code;
        } catch (error) {
            console.error('Failed to create room:', error);
            throw error;
        }
    }

    connectToRoom(roomCode: string, onMessage: (type: string, data: any) => void): void {
        const { userId, username } = this.getConfig();
        const wsUrl = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');

        this.ws = new WebSocket(`${wsUrl}/rooms/${roomCode}/ws?userId=${userId}&username=${encodeURIComponent(username)}`);

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                onMessage(message.type, message.data);
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        };

        this.ws.onclose = () => {
            onMessage('disconnected', {});
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            onMessage('error', { message: 'Connection error' });
        };
    }

    sendRoomMessage(type: string, data: any = {}): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type, data }));
        }
    }

    updateProgress(progress: number, wpm: number): void {
        this.sendRoomMessage('progress', { progress, wpm });
    }

    finishGame(result: GameResult): void {
        this.sendRoomMessage('finish', result);
    }

    startGame(codeSnippet: string): void {
        this.sendRoomMessage('start', { codeSnippet });
    }

    disconnectRoom(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
