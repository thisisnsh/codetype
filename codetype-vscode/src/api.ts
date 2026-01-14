import * as vscode from 'vscode';
import { AuthService } from './auth';

const API_BASE = process.env.CODETYPE_API_URL || '';
const OFFLINE_MODE = !API_BASE;

export interface LeaderboardEntry {
    rank: number;
    userId: string;
    username: string;
    photoURL?: string;
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
    language?: string;
}

export interface UserStats {
    totalGamesPlayed: number;
    totalWpm: number;
    bestWpm: number;
    avgWpm: number;
    currentStreak: number;
    longestStreak: number;
}

export interface StreakData {
    activities: Record<string, { gamesPlayed: number; totalWpm: number; bestWpm: number }>;
    currentStreak: number;
    longestStreak: number;
    totalActiveDays: number;
}

export interface GameDocument {
    id: string;
    wpm: number;
    accuracy: number;
    time: number;
    characters: number;
    errors: number;
    playedAt: number;
    date: string;
}

export type LeaderboardTimeframe = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'alltime';

export class ApiClient {
    private context: vscode.ExtensionContext;
    private authService: AuthService;

    constructor(context: vscode.ExtensionContext, authService: AuthService) {
        this.context = context;
        this.authService = authService;
    }

    private getConfig() {
        const config = vscode.workspace.getConfiguration('codetype');
        return {
            userId: config.get<string>('userId') || '',
            username: config.get<string>('username') || 'Anonymous'
        };
    }

    /**
     * Submit a game score - uses authenticated endpoint if logged in, falls back to anonymous
     */
    async submitScore(result: GameResult): Promise<void> {
        // Always store locally
        this.storeLocalScore(result);

        if (OFFLINE_MODE) {
            return;
        }

        // Try authenticated submission first
        if (this.authService.isAuthenticated()) {
            try {
                const authHeader = await this.authService.getAuthHeader();
                const response = await fetch(`${API_BASE}/games`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeader
                    },
                    body: JSON.stringify(result)
                });

                if (response.ok) {
                    const data = await response.json() as {
                        success: boolean;
                        updatedStats?: {
                            totalGamesPlayed: number;
                            avgWpm: number;
                            bestWpm: number;
                            currentStreak: number;
                        };
                    };

                    // Update local cache with server stats
                    if (data.updatedStats) {
                        this.updateLocalStatsFromServer(data.updatedStats);
                    }
                    return;
                }
            } catch (error) {
                console.warn('Failed to submit authenticated score:', error);
            }
        }

        // Fall back to anonymous submission
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

    private updateLocalStatsFromServer(serverStats: { totalGamesPlayed: number; avgWpm: number; bestWpm: number; currentStreak: number }) {
        const stats = this.context.globalState.get<any>('localStats') || {
            games: [],
            totalWpm: 0,
            bestWpm: 0,
            gamesPlayed: 0
        };

        stats.bestWpm = Math.max(stats.bestWpm, serverStats.bestWpm);
        stats.currentStreak = serverStats.currentStreak;

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

    /**
     * Get user stats from server (authenticated)
     */
    async getUserStats(): Promise<UserStats | null> {
        if (OFFLINE_MODE || !this.authService.isAuthenticated()) {
            const localStats = this.getLocalStats();
            return {
                totalGamesPlayed: localStats.gamesPlayed,
                totalWpm: localStats.totalWpm,
                bestWpm: localStats.bestWpm,
                avgWpm: localStats.gamesPlayed > 0 ? Math.round(localStats.totalWpm / localStats.gamesPlayed) : 0,
                currentStreak: localStats.currentStreak || 0,
                longestStreak: localStats.longestStreak || 0
            };
        }

        try {
            const user = this.authService.getCurrentUser();
            if (!user) return null;

            const authHeader = await this.authService.getAuthHeader();
            const response = await fetch(`${API_BASE}/users/${user.uid}/stats`, {
                headers: authHeader
            });

            if (!response.ok) return null;

            const data = await response.json() as { user: UserStats };
            return data.user;
        } catch (error) {
            console.error('Failed to fetch user stats:', error);
            return null;
        }
    }

    /**
     * Get streak data for heatmap visualization
     */
    async getStreakData(year?: number): Promise<StreakData | null> {
        if (OFFLINE_MODE || !this.authService.isAuthenticated()) {
            return null;
        }

        try {
            const user = this.authService.getCurrentUser();
            if (!user) return null;

            const currentYear = year || new Date().getFullYear();
            const authHeader = await this.authService.getAuthHeader();
            const response = await fetch(`${API_BASE}/users/${user.uid}/streaks?year=${currentYear}`, {
                headers: authHeader
            });

            if (!response.ok) return null;

            return await response.json() as StreakData;
        } catch (error) {
            console.error('Failed to fetch streak data:', error);
            return null;
        }
    }

    /**
     * Get recent games for authenticated user
     */
    async getRecentGames(): Promise<GameDocument[]> {
        if (OFFLINE_MODE || !this.authService.isAuthenticated()) {
            const localStats = this.getLocalStats();
            return (localStats.games || []).slice(-20).reverse().map((g: any, i: number) => ({
                id: `local-${i}`,
                wpm: g.wpm,
                accuracy: g.accuracy,
                time: g.time,
                characters: g.characters,
                errors: g.errors,
                playedAt: g.timestamp,
                date: new Date(g.timestamp).toISOString().split('T')[0]
            }));
        }

        try {
            const user = this.authService.getCurrentUser();
            if (!user) return [];

            const authHeader = await this.authService.getAuthHeader();
            const response = await fetch(`${API_BASE}/users/${user.uid}/stats`, {
                headers: authHeader
            });

            if (!response.ok) return [];

            const data = await response.json() as { recentGames: GameDocument[] };
            return data.recentGames || [];
        } catch (error) {
            console.error('Failed to fetch recent games:', error);
            return [];
        }
    }

    async getLeaderboard(timeframe: LeaderboardTimeframe = 'weekly'): Promise<LeaderboardEntry[]> {
        if (OFFLINE_MODE) {
            const stats = this.getLocalStats();
            if (stats.gamesPlayed === 0) return [];

            const { username, userId } = this.getConfig();
            return [{
                rank: 1,
                userId,
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

    /**
     * Check if user is authenticated
     */
    isAuthenticated(): boolean {
        return this.authService.isAuthenticated();
    }

    /**
     * Get current authenticated user
     */
    getCurrentUser() {
        return this.authService.getCurrentUser();
    }
}
