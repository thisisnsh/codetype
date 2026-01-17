import * as vscode from 'vscode';
import { AuthService } from './auth';

const API_BASE = 'https://codetype-api.thisisnsh.workers.dev';
const OFFLINE_MODE = false;


export interface GameResult {
    wpm: number;
    accuracy: number;
    time: number;
    charsTyped: number;
    totalChars: number;
    language?: string;
}

export interface UserStats {
    totalGamesPlayed: number;
    avgWpm: number;
    bestWpm: number;
    totalCharsTyped: number;
    currentStreak: number;
    longestStreak: number;
}

export interface StreakData {
    activities: Record<string, { gamesPlayed: number; totalWpm: number; bestWpm: number }>;
    currentStreak: number;
    longestStreak: number;
    totalActiveDays: number;
}

export interface RecentSession {
    epochKey: string;
    wpm: number;
    accuracy: number;
    charsTyped: number;
    totalChars: number;
    createdAt: number;
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
     * Returns { saved: boolean, error?: string } to indicate if the session was saved to server.
     */
    async submitScore(result: GameResult): Promise<{ saved: boolean; error?: string }> {
        // Always store in-session
        this.storeLocalScore(result);

        console.log('[CodeType] submitScore called with:', result);
        console.log('[CodeType] OFFLINE_MODE:', OFFLINE_MODE);
        console.log('[CodeType] isAuthenticated:', this.authService.isAuthenticated());

        if (OFFLINE_MODE) {
            return { saved: false, error: 'Offline mode' };
        }

        // Try authenticated submission first
        if (this.authService.isAuthenticated()) {
            try {
                const user = this.authService.getCurrentUser();
                console.log('[CodeType] Current user:', user?.uid, user?.email);

                const authHeader = await this.authService.getAuthHeader();
                console.log('[CodeType] Auth header obtained:', !!authHeader.Authorization);

                const requestBody = JSON.stringify(result);
                console.log('[CodeType] Sending to:', `${API_BASE}/games`);
                console.log('[CodeType] Request body:', requestBody);

                const response = await fetch(`${API_BASE}/games`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeader
                    },
                    body: requestBody
                });

                console.log('[CodeType] Response status:', response.status);

                if (response.ok) {
                    const data = await response.json() as {
                        success: boolean;
                        sessionKey?: string;
                        updatedStats?: {
                            totalGamesPlayed: number;
                            avgWpm: number;
                            bestWpm: number;
                            currentStreak: number;
                        };
                    };
                    console.log('[CodeType] Response data:', data);

                    // Update local cache with server stats
                    if (data.updatedStats) {
                        this.updateLocalStatsFromServer(data.updatedStats);
                    }
                    return { saved: true };
                } else {
                    const errorText = await response.text();
                    console.error('[CodeType] Error response:', response.status, errorText);
                    try {
                        const errorData = JSON.parse(errorText) as { error?: string };
                        return { saved: false, error: errorData.error || `Server error: ${response.status}` };
                    } catch {
                        return { saved: false, error: `Server error: ${response.status}` };
                    }
                }
            } catch (error) {
                console.error('[CodeType] Exception during submit:', error);
                return { saved: false, error: error instanceof Error ? error.message : 'Network error' };
            }
        }

        // Anonymous mode stays local only.
        console.log('[CodeType] Not authenticated, skipping server save');
        return { saved: false, error: 'Not authenticated - sign in to save progress' };
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

            const data = await response.json() as { stats: UserStats };
            return data.stats;
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
     * Get recent sessions for authenticated user
     */
    async getRecentGames(): Promise<RecentSession[]> {
        if (OFFLINE_MODE || !this.authService.isAuthenticated()) {
            const localStats = this.getLocalStats();
            return (localStats.games || []).slice(-20).reverse().map((g: any, i: number) => ({
                epochKey: `local-${i}`,
                wpm: g.wpm,
                accuracy: g.accuracy,
                charsTyped: g.charsTyped || 0,
                totalChars: g.totalChars || 0,
                createdAt: g.timestamp
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

            const data = await response.json() as { recentSessions: RecentSession[] };
            return data.recentSessions || [];
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
