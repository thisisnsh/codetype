import * as vscode from 'vscode';

const API_BASE = process.env.CODETYPE_API_URL || '';
const OFFLINE_MODE = !API_BASE;

export interface LeaderboardEntry {
    rank: number;
    username: string;
    avgWpm: number;
    gamesPlayed: number;
    bestWpm: number;
}

export interface GameResult {
    wpm: number;
    accuracy: number;
    time: number;
    characters: number;
    errors: number;
}

export type LeaderboardTimeframe = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'alltime';

export class ApiClient {
    private context: vscode.ExtensionContext;

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
        this.storeLocalScore(result);

        if (!OFFLINE_MODE) {
            const { userId, username } = this.getConfig();
            try {
                await fetch(`${API_BASE}/scores`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, username, ...result })
                });
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

    async getLeaderboard(timeframe: LeaderboardTimeframe = 'weekly'): Promise<LeaderboardEntry[]> {
        if (OFFLINE_MODE) {
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
}
