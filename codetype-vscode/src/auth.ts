import * as vscode from 'vscode';

const API_BASE = 'https://codetype-api.thisisnsh.workers.dev';
const AUTH_URL = 'https://codetype.ai';

export interface AuthUser {
    uid: string;
    email: string;
    displayName: string;
    username: string;
    photoURL?: string;
    totalGamesPlayed: number;
    bestWpm: number;
    avgWpm: number;
    currentStreak: number;
    longestStreak: number;
}

export interface AuthState {
    isAuthenticated: boolean;
    user: AuthUser | null;
    token: string | null;
}

export class AuthService {
    private context: vscode.ExtensionContext;
    private _onAuthStateChanged: vscode.EventEmitter<AuthState> = new vscode.EventEmitter<AuthState>();
    readonly onAuthStateChanged: vscode.Event<AuthState> = this._onAuthStateChanged.event;

    private authState: AuthState = {
        isAuthenticated: false,
        user: null,
        token: null
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadStoredAuth();
    }

    /**
     * Load auth state from storage on startup
     */
    private async loadStoredAuth() {
        const token = await this.context.secrets.get('codetype.token');

        if (token) {
            try {
                // Verify the token is still valid
                const user = await this.verifyToken(token);
                if (user) {
                    this.authState = {
                        isAuthenticated: true,
                        user,
                        token
                    };
                    this._onAuthStateChanged.fire(this.authState);
                    return;
                }
            } catch (error) {
                console.warn('Failed to restore auth session:', error);
            }
        }

        // No valid auth state
        this.authState = { isAuthenticated: false, user: null, token: null };
        this._onAuthStateChanged.fire(this.authState);
    }

    /**
     * Get the current auth state
     */
    getAuthState(): AuthState {
        return this.authState;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated(): boolean {
        return this.authState.isAuthenticated;
    }

    /**
     * Get the current user
     */
    getCurrentUser(): AuthUser | null {
        return this.authState.user;
    }

    /**
     * Get the current auth token for API calls
     */
    async getAuthToken(): Promise<string | null> {
        if (!this.authState.token) {
            return null;
        }

        // Tokens expire after 1 hour; prompt re-auth if verification fails.
        return this.authState.token;
    }

    /**
     * Get authorization header for API requests
     */
    async getAuthHeader(): Promise<Record<string, string>> {
        const token = await this.getAuthToken();
        if (token) {
            return { 'Authorization': `Bearer ${token}` };
        }
        return {};
    }

    /**
     * Open browser to login
     */
    async login(): Promise<void> {
        const loginUrl = `${AUTH_URL}/auth/login/?source=extension`;
        await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
        vscode.window.showInformationMessage('Please complete sign in in your browser...');
    }

    /**
     * Handle auth callback from browser
     */
    async handleAuthCallback(uri: vscode.Uri): Promise<boolean> {
        try {
            const params = new URLSearchParams(uri.query);
            const token = params.get('token');

            if (!token) {
                vscode.window.showErrorMessage('Authentication failed: Missing token');
                return false;
            }

            // Verify the token
            const user = await this.verifyToken(token);
            if (!user) {
                vscode.window.showErrorMessage('Authentication failed: Invalid token');
                return false;
            }

            // Store tokens securely
            await this.context.secrets.store('codetype.token', token);

            // Update auth state
            this.authState = {
                isAuthenticated: true,
                user,
                token
            };
            this._onAuthStateChanged.fire(this.authState);

            vscode.window.showInformationMessage(`Signed in as ${user.username || user.email}!`);
            return true;
        } catch (error) {
            console.error('Auth callback error:', error);
            vscode.window.showErrorMessage('Authentication failed');
            return false;
        }
    }

    /**
     * Log out the current user
     */
    async logout(): Promise<void> {
        // Clear stored tokens
        await this.context.secrets.delete('codetype.token');

        // Clear auth state
        this.authState = {
            isAuthenticated: false,
            user: null,
            token: null
        };
        this._onAuthStateChanged.fire(this.authState);

        vscode.window.showInformationMessage('Signed out successfully');
    }

    /**
     * Verify a token with the backend
     */
    private async verifyToken(token: string): Promise<AuthUser | null> {
        if (!API_BASE) {
            console.warn('No API base configured, skipping token verification');
            return null;
        }

        try {
            const response = await fetch(`${API_BASE}/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idToken: token })
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json() as { valid: boolean; user?: AuthUser; needsUsername?: boolean; reason?: string };

            if (!data.valid) {
                console.error('Token verification failed:', data.reason);
                return null;
            }

            if (data.needsUsername) {
                // User needs to set a username
                const username = await this.promptForUsername(token);
                if (username) {
                    return await this.registerUsername(token, username);
                }
                return null;
            }

            return data.user || null;
        } catch (error) {
            console.error('Token verification failed:', error);
            return null;
        }
    }

    /**
     * Prompt user to choose a username
     */
    private async promptForUsername(_token: string): Promise<string | undefined> {
        return await vscode.window.showInputBox({
            prompt: 'Choose your username for CodeType',
            placeHolder: 'speedcoder42',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.length < 2) {
                    return 'Username must be at least 2 characters';
                }
                if (value.length > 20) {
                    return 'Username must be 20 characters or less';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Only letters, numbers, underscores, and hyphens allowed';
                }
                return null;
            }
        });
    }

    /**
     * Register a username for a new user
     */
    private async registerUsername(token: string, username: string): Promise<AuthUser | null> {
        if (!API_BASE) {
            return null;
        }

        try {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ username })
            });

            if (!response.ok) {
                const error = await response.json() as { error?: string };
                if (error.error === 'Username already taken') {
                    vscode.window.showErrorMessage('Username is already taken, please choose another');
                    const newUsername = await this.promptForUsername(token);
                    if (newUsername) {
                        return this.registerUsername(token, newUsername);
                    }
                }
                return null;
            }

            const data = await response.json() as { success: boolean; user?: AuthUser };
            return data.user || null;
        } catch (error) {
            console.error('Username registration failed:', error);
            return null;
        }
    }

    /**
     * Dispose resources
     */
    dispose() {
        this._onAuthStateChanged.dispose();
    }
}
