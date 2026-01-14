import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { CodeTypePanel } from './webview/CodeTypePanel';
import { CodeSampleProvider } from './codeSamples';
import { ApiClient } from './api';
import { AuthService } from './auth';

let apiClient: ApiClient;
let codeSampleProvider: CodeSampleProvider;
let authService: AuthService;

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeType extension is activating...');
    vscode.window.showInformationMessage('CodeType activated! Press Cmd+Shift+T to start.');

    // Initialize services
    authService = new AuthService(context);
    apiClient = new ApiClient(context, authService);
    codeSampleProvider = new CodeSampleProvider();

    // Ensure user has an ID (for anonymous mode fallback)
    ensureUserId(context);

    // Register URI handler for auth callback
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
                if (uri.path === '/auth-callback') {
                    authService.handleAuthCallback(uri).then((success) => {
                        if (success) {
                            // Refresh the panel if open
                            CodeTypePanel.refresh();
                        }
                    });
                }
            }
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codetype.start', () => {
            CodeTypePanel.createOrShow(context.extensionUri, context, apiClient, codeSampleProvider, authService, 'menu');
        }),

        vscode.commands.registerCommand('codetype.solo', () => {
            CodeTypePanel.createOrShow(context.extensionUri, context, apiClient, codeSampleProvider, authService, 'solo');
        }),

        vscode.commands.registerCommand('codetype.setUsername', async () => {
            await setUsername(context);
        }),

        vscode.commands.registerCommand('codetype.stats', () => {
            CodeTypePanel.createOrShow(context.extensionUri, context, apiClient, codeSampleProvider, authService, 'stats');
        }),

        vscode.commands.registerCommand('codetype.login', async () => {
            await authService.login();
        }),

        vscode.commands.registerCommand('codetype.logout', async () => {
            await authService.logout();
            CodeTypePanel.refresh();
        })
    );

    // Listen for auth state changes
    context.subscriptions.push(
        authService.onAuthStateChanged((state) => {
            console.log('Auth state changed:', state.isAuthenticated ? 'authenticated' : 'not authenticated');
        })
    );

    // Clean up on deactivate
    context.subscriptions.push({
        dispose: () => {
            authService.dispose();
        }
    });
}

function ensureUserId(_context: vscode.ExtensionContext): string {
    const config = vscode.workspace.getConfiguration('codetype');
    let userId = config.get<string>('userId') || '';

    if (!userId) {
        userId = uuidv4();
        config.update('userId', userId, vscode.ConfigurationTarget.Global);
    }

    return userId;
}

async function setUsername(_context: vscode.ExtensionContext): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('codetype');

    const username = await vscode.window.showInputBox({
        prompt: 'Choose your username for the leaderboard',
        placeHolder: 'speedcoder42',
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

    if (username) {
        await config.update('username', username, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Username set to: ${username}`);
    }

    return username;
}

export function deactivate() {}
