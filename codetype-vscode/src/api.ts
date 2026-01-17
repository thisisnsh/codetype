import * as vscode from 'vscode';
import { AuthService } from './auth';

const API_BASE = 'https://codetype-api.thisisnsh.workers.dev';
const OFFLINE_MODE = false;


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

export class ApiClient {
    private context: vscode.ExtensionContext;
    private authService: AuthService;
    private sessionStats = {
        games: [] as Array<GameResult & { timestamp: number }>,
        totalWpm: 0,
        bestWpm: 0,
        gamesPlayed: 0,
        currentStreak: 0,
        longestStreak: 0
    };

    constructor(context: vscode.ExtensionContext, authService: AuthService) {
        this.context = context;
        this.authService = authService;
    }

    private getUserId(): string {
        const config = vscode.workspace.getConfiguration('codetype');
        return config.get<string>('userId') || '';
    }

    /**
     * Submit a game score - uses authenticated endpoint if logged in, otherwise local only.
     */
    async submitScore(result: GameResult): Promise<void> {
        // Always store in-session
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

        // Anonymous mode stays local only.
    }

    private storeLocalScore(result: GameResult) {
        const stats = this.sessionStats;
        stats.games.push({ ...result, timestamp: Date.now() });
        stats.totalWpm += result.wpm;
        stats.bestWpm = Math.max(stats.bestWpm, result.wpm);
        stats.gamesPlayed++;
    }

    private updateLocalStatsFromServer(serverStats: { totalGamesPlayed: number; avgWpm: number; bestWpm: number; currentStreak: number }) {
        const stats = this.sessionStats;
        stats.bestWpm = Math.max(stats.bestWpm, serverStats.bestWpm);
        stats.currentStreak = serverStats.currentStreak;
    }

    getLocalStats() {
        return this.sessionStats;
    }

    /**
     * Get user stats from server (authenticated)
     */
    async getUserStats(): Promise<UserStats | null> {
        if (OFFLINE_MODE || !this.authService.isAuthenticated()) {
            return null;
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

    /**
     * Create a multiplayer room
     */
    async createRoom(hostId: string, hostDisplayName: string): Promise<string | null> {
        if (OFFLINE_MODE) {
            return null;
        }

        try {
            const response = await fetch(`${API_BASE}/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostId, hostUsername: hostDisplayName })
            });

            if (!response.ok) return null;

            const data = await response.json() as { code: string };
            return data.code;
        } catch (error) {
            console.error('Failed to create room:', error);
            return null;
        }
    }

    /**
     * Get WebSocket URL for room
     */
    getWebSocketUrl(roomCode: string, userId: string, displayName: string): string | null {
        if (OFFLINE_MODE || !API_BASE) {
            return null;
        }

        const wsBase = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');
        return `${wsBase}/rooms/${roomCode}/ws?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(displayName)}`;
    }

    /**
     * Get API base URL (for sharing links)
     */
    getApiBaseUrl(): string {
        return API_BASE;
    }
}
