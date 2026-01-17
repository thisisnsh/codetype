import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { CodeTypePanel } from './webview/CodeTypePanel';
import { CodeSampleProvider } from './codeSamples';
import { ApiClient } from './api';
import { AuthService } from './auth';

let apiClient: ApiClient;
let codeSampleProvider: CodeSampleProvider;
let authService: AuthService;

export function activate(context: vscode.ExtensionContext) {
    console.log('CodeType extension is activating...');
    vscode.window.showInformationMessage('CodeType activated! Press Cmd+Shift+T to open the game.');

    // Initialize services
    authService = new AuthService(context);
    apiClient = new ApiClient(context, authService);
    codeSampleProvider = new CodeSampleProvider();

    // Ensure user has an ID for multiplayer sessions.
    ensureUserId(context);

    // Register URI handler for auth callback
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
                if (uri.path === '/auth-callback') {
                    authService.handleAuthCallback(uri).then((success) => {
                        if (success) {
                            // Refresh the panel if open
                            CodeTypePanel.refreshAll();
                        }
                    });
                }
            }
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('codetype.typingGame', () => {
            CodeTypePanel.createOrShow(context.extensionUri, context, apiClient, codeSampleProvider, authService, 'menu');
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
        userId = crypto.randomUUID();
        config.update('userId', userId, vscode.ConfigurationTarget.Global);
    }

    return userId;
}

export function deactivate() {}
