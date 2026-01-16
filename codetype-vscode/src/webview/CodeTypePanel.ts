import * as vscode from 'vscode';
import { ApiClient } from '../api';
import { CodeSampleProvider } from '../codeSamples';
import { AuthService } from '../auth';

type GameMode = 'menu' | 'solo' | 'stats' | 'team' | 'playing' | 'multiplayer' | 'lobby';

export class CodeTypePanel {
    private static _panels = new Set<CodeTypePanel>();
    private static _panelCounts = new Map<string, number>();
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private readonly _api: ApiClient;
    private readonly _codeSamples: CodeSampleProvider;
    private readonly _authService: AuthService;
    private readonly _panelLabel: string;
    private _disposables: vscode.Disposable[] = [];
    private _currentMode: GameMode = 'menu';

    public static createOrShow(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        api: ApiClient,
        codeSamples: CodeSampleProvider,
        authService: AuthService,
        mode: GameMode
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const baseName = CodeTypePanel._getPanelBaseName(mode);
        const panelTitle = CodeTypePanel._getUniquePanelTitle(baseName);

        // Create a new panel that looks like a regular editor
        const panel = vscode.window.createWebviewPanel(
            'codeType',
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        const panelInstance = new CodeTypePanel(panel, extensionUri, context, api, codeSamples, authService, mode, panelTitle);
        CodeTypePanel._panels.add(panelInstance);
    }

    public static refreshAll() {
        for (const panel of CodeTypePanel._panels) {
            panel._update();
        }
    }

    private static _getPanelBaseName(mode: GameMode): string {
        switch (mode) {
            case 'solo':
            case 'playing':
                return 'solo';
            case 'stats':
                return 'stats';
            case 'team':
            case 'lobby':
            case 'multiplayer':
                return 'team';
            case 'menu':
            default:
                return 'menu';
        }
    }

    private static _getUniquePanelTitle(baseName: string): string {
        const nextCount = (CodeTypePanel._panelCounts.get(baseName) ?? 0) + 1;
        CodeTypePanel._panelCounts.set(baseName, nextCount);
        const suffix = nextCount === 1 ? '' : `-${nextCount}`;
        return `${baseName}${suffix}.ts`;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        api: ApiClient,
        codeSamples: CodeSampleProvider,
        authService: AuthService,
        mode: GameMode,
        panelLabel: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        this._api = api;
        this._codeSamples = codeSamples;
        this._authService = authService;
        this._currentMode = mode;
        this._panelLabel = panelLabel;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    public setMode(mode: GameMode) {
        this._currentMode = mode;
        this._update();
    }

    private async _handleMessage(message: any) {
        switch (message.type) {
            case 'startSolo':
                const code = await this._codeSamples.getRandomSample(true);
                this._panel.webview.postMessage({ type: 'loadCode', code });
                break;

            case 'refreshCode':
                const newCode = await this._codeSamples.getRandomSample(true);
                this._panel.webview.postMessage({ type: 'loadCode', code: newCode });
                break;

            case 'gameFinished':
                this._api.submitScore(message.result);
                const stats = this._api.getLocalStats();
                this._panel.webview.postMessage({
                    type: 'showResults',
                    result: message.result,
                    stats: {
                        avgWpm: stats.gamesPlayed > 0 ? Math.round(stats.totalWpm / stats.gamesPlayed) : 0,
                        bestWpm: stats.bestWpm,
                        gamesPlayed: stats.gamesPlayed
                    }
                });
                break;

            case 'getStats':
                const streakYear = typeof message.streakYear === 'number' ? message.streakYear : undefined;
                const userStats = await this._api.getUserStats();
                const streakData = await this._api.getStreakData(streakYear);
                const recentGames = await this._api.getRecentGames();
                const resolvedStreakYear = streakYear ?? new Date().getFullYear();
                this._panel.webview.postMessage({
                    type: 'stats',
                    data: {
                        ...(userStats || {}),
                        games: recentGames,
                        streakData,
                        streakYear: resolvedStreakYear
                    },
                    isAuthenticated: this._api.isAuthenticated(),
                    user: this._api.getCurrentUser()
                });
                break;

            case 'login':
                await this._authService.login();
                break;

            case 'logout':
                await this._authService.logout();
                CodeTypePanel.refreshAll();
                break;

            case 'navigate':
                this.setMode(message.mode);
                break;

            case 'createRoom':
                const config = vscode.workspace.getConfiguration('codetype');
                const userId = config.get<string>('userId') || 'anonymous';
                const displayName = message.displayName || 'Player';
                const roomCode = await this._api.createRoom(userId, displayName);
                if (roomCode) {
                    const wsUrl = this._api.getWebSocketUrl(roomCode, userId, displayName);
                    this._panel.webview.postMessage({
                        type: 'roomCreated',
                        roomCode,
                        wsUrl,
                        userId
                    });
                } else {
                    this._panel.webview.postMessage({ type: 'error', message: 'Failed to create room. Please check your connection.' });
                }
                break;

            case 'joinRoom':
                const joinConfig = vscode.workspace.getConfiguration('codetype');
                const joinUserId = joinConfig.get<string>('userId') || 'anonymous';
                const joinDisplayName = message.displayName || 'Player';
                const joinWsUrl = this._api.getWebSocketUrl(message.roomCode.toUpperCase(), joinUserId, joinDisplayName);
                if (joinWsUrl) {
                    this._panel.webview.postMessage({
                        type: 'roomJoined',
                        roomCode: message.roomCode.toUpperCase(),
                        wsUrl: joinWsUrl,
                        userId: joinUserId
                    });
                } else {
                    this._panel.webview.postMessage({ type: 'error', message: 'Failed to join room.' });
                }
                break;

            case 'getCodeForMultiplayer':
                const multiplayerCode = await this._codeSamples.getRandomSample(true);
                this._panel.webview.postMessage({ type: 'multiplayerCode', code: multiplayerCode });
                break;
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this._panelLabel}</title>
    <style>
        ${this._getStyles()}
    </style>
</head>
<body>
    <div id="app">
        ${this._getInitialContent()}
    </div>
    <script>
        ${this._getScript()}
    </script>
</body>
</html>`;
    }

    private _getStyles() {
        return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            height: 100vh;
            overflow: hidden;
        }

        #app {
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        /* Editor-like header */
        .editor-header {
            background: var(--vscode-editorGroupHeader-tabsBackground);
            padding: 8px 16px;
            border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder, var(--vscode-panel-border));
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
        }

        .editor-header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .stats-bar {
            display: flex;
            align-items: center;
            gap: 16px;
            color: var(--vscode-descriptionForeground);
        }

        .stat {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .stat-value {
            color: var(--vscode-textLink-foreground);
            font-weight: 600;
        }

        /* Code editor area */
        .editor-container {
            flex: 1;
            display: flex;
            overflow: hidden;
            font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', Consolas, monospace);
            font-size: var(--vscode-editor-font-size, 14px);
        }

        .line-numbers {
            background: var(--vscode-editorGutter-background, var(--vscode-editor-background));
            padding: 16px 12px;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            font-size: inherit;
            line-height: 1.6;
            user-select: none;
            min-width: 50px;
        }

        .code-area {
            flex: 1;
            padding: 16px;
            font-size: inherit;
            line-height: 1.6;
            overflow-y: auto;
            position: relative;
        }

        .code-line {
            display: flex;
            min-height: 22.4px;
            padding: 0 4px;
        }

        .code-line.active {
            background: var(--vscode-editor-lineHighlightBackground);
        }

        .char {
            display: inline-block;
            white-space: pre;
        }

        .char.pending {
            color: var(--vscode-editorLineNumber-foreground);
            opacity: 0.5;
        }

        .char.correct {
            color: var(--vscode-terminal-ansiGreen, #4ec9b0);
        }

        .char.error {
            color: var(--vscode-errorForeground);
            text-decoration: underline wavy;
        }

        .char.current {
            background: var(--vscode-editor-selectionBackground);
            color: var(--vscode-editor-foreground);
            animation: blink 1s infinite;
        }

        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }

        .hidden-input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
        }

        /* Menu styles */
        .menu-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
            height: 100%;
            gap: 20px;
            padding: 32px;
            text-align: left;
        }

        .menu-title {
            font-size: 28px;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 4px;
        }

        .menu-subtitle {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            margin-bottom: 20px;
        }

        .menu-buttons {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 260px;
        }

        .actions-bar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .actions-bar .menu-btn {
            width: auto;
        }

        .menu-btn {
            background: var(--vscode-button-secondaryBackground);
            border: 1px solid var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 10px 16px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.15s;
            font-family: inherit;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 10px;
            border-radius: 2px;
        }

        .menu-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .menu-btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }

        .menu-btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        /* Welcome screen - VS Code Getting Started style */
        .welcome-shell {
            --welcome-offset: clamp(-140px, -14vh, -72px);
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 24px 52px 56px;
            overflow-y: auto;
        }

        .welcome-container {
            width: 100%;
            max-width: 882px;
            display: flex;
            flex-direction: column;
            gap: 20px;
            transform: translateY(var(--welcome-offset));
        }

        .welcome-header {
            display: flex;
            flex-direction: column;
            gap: 0;
            margin-bottom: 4px;
        }

        .welcome-title {
            font-size: 32px;
            font-weight: 400;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
        }

        .welcome-subtitle {
            color: var(--vscode-descriptionForeground);
            font-size: 16px;
            font-weight: 400;
            margin-top: 0;
        }

        .welcome-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10%;
        }

        .welcome-column {
            display: flex;
            flex-direction: column;
            gap: 26px;
            min-width: 0;
        }

        .welcome-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .welcome-section-title {
            font-size: 16px;
            font-weight: 400;
            color: var(--vscode-foreground);
            letter-spacing: 0.04em;
        }

        .start-links {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .start-link {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            font-family: inherit;
            font-size: 14px;
            cursor: pointer;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            line-height: 1.5;
        }

        .start-link:hover {
            text-decoration: underline;
        }

        .start-icon {
            width: 18px;
            height: 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-textLink-foreground);
            flex-shrink: 0;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 14px;
        }

        .stat-card {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .stat-card-value {
            font-size: 22px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .stat-card-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .streak-section {
            margin-top: 12px;
        }

        .streak-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-bottom: 8px;
        }

        .streak-select {
            background: none;
            color: var(--vscode-foreground);
            border: none;
            font-family: inherit;
            font-size: 14px;
            padding: 0;
            cursor: pointer;
            appearance: none;
        }

        .streak-select:hover {
            color: var(--vscode-textLink-foreground);
        }

        .streak-calendar {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 8px;
        }

        .streak-day-labels {
            display: grid;
            grid-template-columns: repeat(7, 18px);
            gap: 5px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
        }

        .streak-days {
            display: grid;
            grid-template-columns: repeat(7, 18px);
            gap: 5px;
        }

        .streak-day {
            width: 18px;
            height: 18px;
            border-radius: 3px;
            background: var(--vscode-editor-inactiveSelectionBackground, #3c3c3c);
        }

        .streak-day.active {
            background: var(--vscode-terminal-ansiGreen, #4ec9b0);
        }

        .streak-day.today {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 1px;
        }

        .streak-day.empty {
            visibility: hidden;
        }

        .stats-auth {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            margin-top: 0;
            color: var(--vscode-foreground);
            font-size: 14px;
            line-height: 1.5;
            width: fit-content;
            align-self: flex-start;
        }

        .stats-auth-button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-family: inherit;
            font-size: 14px;
            line-height: 1.5;
            padding: 4px 0;
            text-align: left;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .stats-auth-button:hover .auth-highlight {
            text-decoration: underline;
        }

        .auth-status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .auth-icon {
            width: 18px;
            height: 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--vscode-foreground);
            flex-shrink: 0;
        }

        .auth-highlight {
            color: var(--vscode-textLink-foreground);
            font-weight: normal;
        }

        .auth-action {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-family: inherit;
            font-size: 14px;
            line-height: 1.5;
            padding: 4px 0;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        .auth-action:hover .auth-highlight {
            text-decoration: underline;
        }

        .recent-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .recent-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-widget-border, transparent);
        }

        .recent-item:last-child {
            border-bottom: none;
        }

        .recent-wpm {
            color: var(--vscode-textLink-foreground);
            font-weight: 600;
            min-width: 55px;
        }

        .recent-accuracy {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            min-width: 40px;
        }

        .recent-date {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-left: auto;
        }

        .recent-empty {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            font-style: normal;
        }

        .welcome-footer {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-top: 64px;
            padding-top: 16px;
        }

        .welcome-footer a,
        .welcome-footer button {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            background: none;
            border: none;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
            padding: 0;
        }

        .welcome-footer a:hover,
        .welcome-footer button:hover {
            text-decoration: underline;
        }

        .footer-separator {
            color: var(--vscode-descriptionForeground);
            opacity: 0.4;
        }

        .footer-author {
            color: var(--vscode-descriptionForeground);
        }

        @media (max-width: 600px) {
            .welcome-shell {
                padding: 20px 24px 48px;
            }

            .welcome-grid {
                grid-template-columns: 1fr;
                gap: 32px;
            }
        }

        /* Results overlay */
        .results-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--vscode-editor-background);
            display: flex;
            align-items: flex-start;
            justify-content: flex-start;
            flex-direction: column;
            gap: 20px;
            z-index: 100;
            padding: 32px;
        }

        .results-card {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
            padding: 28px 40px;
            text-align: left;
            border-radius: 4px;
        }

        .results-wpm {
            font-size: 56px;
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
        }

        .results-label {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 20px;
        }

        .results-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin: 20px 0;
        }

        .result-stat-value {
            font-size: 22px;
            color: var(--vscode-editor-foreground);
        }

        .result-stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .section-title {
            color: var(--vscode-textLink-foreground);
            margin-bottom: 16px;
            font-size: 18px;
        }

        .refresh-btn {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 14px;
            padding: 4px 8px;
            display: flex;
            align-items: center;
            gap: 4px;
            font-family: inherit;
            border-radius: 2px;
        }

        .refresh-btn:hover {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-editor-foreground);
        }

        /* Multiplayer styles */
        .lobby-container {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
            height: 100%;
            gap: 24px;
            padding: 20px;
        }

        .room-code {
            font-size: 36px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            letter-spacing: 4px;
            background: var(--vscode-editorWidget-background);
            padding: 16px 32px;
            border-radius: 4px;
        }

        .invite-link {
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--vscode-editorWidget-background);
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 12px;
            max-width: 400px;
        }

        .invite-link input {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--vscode-editor-foreground);
            font-family: inherit;
            font-size: inherit;
            outline: none;
        }

        .copy-btn {
            background: var(--vscode-button-secondaryBackground);
            border: none;
            color: var(--vscode-button-secondaryForeground);
            padding: 6px 12px;
            cursor: pointer;
            font-family: inherit;
            font-size: 11px;
            border-radius: 2px;
        }

        .copy-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .players-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 250px;
        }

        .player-item {
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--vscode-editorWidget-background);
            padding: 12px 16px;
            border-radius: 4px;
        }

        .player-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--vscode-button-secondaryBackground);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }

        .player-name {
            flex: 1;
            color: var(--vscode-editor-foreground);
        }

        .player-host {
            font-size: 10px;
            color: var(--vscode-textLink-foreground);
            background: var(--vscode-badge-background);
            padding: 2px 6px;
            border-radius: 2px;
        }

        .player-progress {
            width: 100px;
            height: 4px;
            background: var(--vscode-editorWidget-background);
            border-radius: 2px;
            overflow: hidden;
        }

        .player-progress-fill {
            height: 100%;
            background: var(--vscode-textLink-foreground);
            transition: width 0.2s;
        }

        .player-wpm {
            min-width: 60px;
            text-align: right;
            font-size: 13px;
            color: var(--vscode-textLink-foreground);
        }

        .countdown-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }

        .countdown-number {
            font-size: 120px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            animation: countdownPulse 1s ease-out;
        }

        @keyframes countdownPulse {
            0% { transform: scale(1.5); opacity: 0; }
            50% { opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
        }

        .join-room-input {
            display: flex;
            gap: 4px;
            margin-top: 16px;
        }

        .join-room-input input {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
            color: var(--vscode-input-foreground);
            padding: 8px 12px;
            font-family: inherit;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 2px;
            width: 150px;
            border-radius: 2px;
        }

        .join-room-input input::placeholder {
            text-transform: none;
            letter-spacing: normal;
        }

        .join-room-input button {
            width: 150px;
            padding: 8px 0;
            justify-content: center;
        }

        .multiplayer-results {
            display: flex;
            flex-direction: column;
            gap: 12px;
            width: 100%;
            max-width: 400px;
        }

        .result-place {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px;
            background: var(--vscode-editorWidget-background);
            border-radius: 4px;
        }

        .result-place.first { border-left: 3px solid #ffd700; }
        .result-place.second { border-left: 3px solid #c0c0c0; }
        .result-place.third { border-left: 3px solid #cd7f32; }

        .result-rank {
            font-size: 24px;
            font-weight: bold;
            min-width: 40px;
        }

        .result-rank.first { color: #ffd700; }
        .result-rank.second { color: #c0c0c0; }
        .result-rank.third { color: #cd7f32; }
    `;
    }

    private _getInitialContent() {
        return `<div class="loading">Loading...</div>`;
    }

    private _getScript() {
        const isAuthenticated = this._authService.isAuthenticated();
        const currentUser = this._authService.getCurrentUser();
        const userJson = currentUser ? JSON.stringify(currentUser) : 'null';
        const displayName = currentUser?.username || currentUser?.displayName || 'Player';
        const displayNameJson = JSON.stringify(displayName);
        return `
        const vscode = acquireVsCodeApi();
        const state = {
            mode: '${this._currentMode}',
            code: '',
            currentPos: 0,
            startTime: null,
            errors: 0,
            currentTimeframe: 'weekly',
            isAuthenticated: ${isAuthenticated},
            user: ${userJson},
            streakDataByYear: {},
            stats: null,
            // Multiplayer state
            roomCode: null,
            wsConnection: null,
            players: [],
            isHost: false,
            userId: null,
            displayName: ${displayNameJson},
            countdownValue: null,
            multiplayerResults: null
        };

        const STREAK_MIN_YEAR = 2026;
        const STREAK_MAX_YEAR = 2036;
        const STREAK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const STREAK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        function clampStreakYear(year) {
            return Math.min(STREAK_MAX_YEAR, Math.max(STREAK_MIN_YEAR, year));
        }

        function clampStreakMonth(month) {
            return Math.min(11, Math.max(0, month));
        }

        let streakViewYear = clampStreakYear(new Date().getFullYear());
        let streakViewMonth = clampStreakMonth(new Date().getMonth());

        let welcomeOffset = null;
        let welcomeOffsetTarget = null;
        let welcomeOffsetRaf = null;

        function computeWelcomeOffset() {
            const height = window.innerHeight || document.documentElement.clientHeight || 0;
            let offset = Math.max(-140, Math.min(-0.14 * height, -72));
            const minHeight = 520;
            const maxHeight = 720;

            if (height <= maxHeight) {
                const t = Math.max(0, Math.min(1, (height - minHeight) / (maxHeight - minHeight)));
                offset *= t;
            }

            return offset;
        }

        function applyWelcomeOffset(offset) {
            const shell = document.querySelector('.welcome-shell');
            if (!shell) {
                return;
            }
            shell.style.setProperty('--welcome-offset', offset.toFixed(1) + 'px');
        }

        function scheduleWelcomeOffsetUpdate() {
            const target = computeWelcomeOffset();
            if (welcomeOffset === null) {
                welcomeOffset = target;
                applyWelcomeOffset(target);
                return;
            }

            welcomeOffsetTarget = target;
            if (welcomeOffsetRaf) {
                return;
            }

            const step = () => {
                const delta = welcomeOffsetTarget - welcomeOffset;
                if (Math.abs(delta) < 0.5) {
                    welcomeOffset = welcomeOffsetTarget;
                    applyWelcomeOffset(welcomeOffset);
                    welcomeOffsetRaf = null;
                    return;
                }

                welcomeOffset += delta * 0.18;
                applyWelcomeOffset(welcomeOffset);
                welcomeOffsetRaf = requestAnimationFrame(step);
            };

            welcomeOffsetRaf = requestAnimationFrame(step);
        }

        window.addEventListener('resize', scheduleWelcomeOffsetUpdate);
        if (typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(() => {
                scheduleWelcomeOffsetUpdate();
            });
            resizeObserver.observe(document.body);
        }

        function init() {
            switch(state.mode) {
                case 'menu':
                    showWelcome();
                    break;
                case 'stats':
                    showWelcome();
                    break;
                case 'solo':
                    vscode.postMessage({ type: 'startSolo' });
                    renderLoading('Preparing code...');
                    break;
                case 'team':
                    showMultiplayerOptions();
                    break;
                case 'stats':
                    ensureStreakDataForView();
                    renderLoading('Loading stats...');
                    break;
            }
        }

        function renderWelcome(data, isAuthenticated, user) {
            const app = document.getElementById('app');
            const stats = data || {};
            const games = stats.games || [];
            const totalGamesPlayed = stats.totalGamesPlayed ?? stats.gamesPlayed ?? 0;
            const totalWpm = stats.totalWpm ?? 0;
            const hasSyncedStats = isAuthenticated && (
                typeof stats.totalGamesPlayed === 'number' ||
                typeof stats.avgWpm === 'number' ||
                typeof stats.bestWpm === 'number' ||
                typeof stats.currentStreak === 'number'
            );
            const avgWpmValue = hasSyncedStats
                ? (stats.avgWpm ?? (totalGamesPlayed > 0 ? Math.round(totalWpm / totalGamesPlayed) : 0))
                : '--';
            const gamesPlayedValue = hasSyncedStats ? totalGamesPlayed : '--';
            const bestWpmValue = hasSyncedStats ? (stats.bestWpm ?? 0) : '--';
            const currentStreakValue = hasSyncedStats ? (stats.currentStreak ?? 0) : '--';
            const streakDataByYear = state.streakDataByYear || {};

            function getActivitiesForYear(year) {
                return streakDataByYear[year]?.activities || {};
            }

            const soloIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5" r="2.7"></circle><path d="M3.5 13.2c.8-2.3 2.6-3.4 4.5-3.4s3.7 1.1 4.5 3.4"></path></svg>';
            const teamIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="5.2" r="2.3"></circle><circle cx="11.2" cy="6" r="1.9"></circle><path d="M1.8 13.2c.6-2 2.1-3 3.9-3"></path><path d="M8.4 13.2c.6-1.7 1.9-2.6 3.4-2.6"></path></svg>';
            const signInIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h3.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7"></path><path d="M3 8h6"></path><path d="M6.5 5.5 9 8l-2.5 2.5"></path></svg>';
            const signOutIcon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2H9"></path><path d="M13 8H7"></path><path d="M10.5 5.5 13 8l-2.5 2.5"></path></svg>';

            function buildMonthOptions(selectedMonth) {
                return STREAK_MONTHS.map((month, index) => {
                    const selected = index === selectedMonth ? ' selected' : '';
                    return \`<option value="\${index}"\${selected}>\${month}</option>\`;
                }).join('');
            }

            function buildYearOptions(selectedYear) {
                const options = [];
                for (let year = STREAK_MIN_YEAR; year <= STREAK_MAX_YEAR; year++) {
                    const selected = year === selectedYear ? ' selected' : '';
                    options.push(\`<option value="\${year}"\${selected}>\${year}</option>\`);
                }
                return options.join('');
            }

            function generateStreakCalendar() {
                const firstDay = new Date(streakViewYear, streakViewMonth, 1);
                const totalDays = new Date(streakViewYear, streakViewMonth + 1, 0).getDate();
                const offset = firstDay.getDay();
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const activities = getActivitiesForYear(streakViewYear);

                let html = '<div class="streak-day-labels">';
                html += STREAK_DAYS.map((day) => \`<span>\${day}</span>\`).join('');
                html += '</div><div class="streak-days">';

                for (let i = 0; i < offset; i++) {
                    html += '<div class="streak-day empty"></div>';
                }

                for (let day = 1; day <= totalDays; day++) {
                    const date = new Date(streakViewYear, streakViewMonth, day);
                    const dateKey = date.toISOString().split('T')[0];
                    const activity = activities[dateKey];
                    const gamesPlayed = activity?.gamesPlayed || 0;
                    const hasActivity = isAuthenticated && gamesPlayed > 0;

                    let classes = 'streak-day';
                    if (hasActivity) classes += ' active';
                    if (date.getTime() === today.getTime()) classes += ' today';

                    const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    const pointLabel = hasActivity ? '1 point' : '0 points';
                    const gameLabel = gamesPlayed ? \` (\${gamesPlayed} game\${gamesPlayed !== 1 ? 's' : ''})\` : '';
                    html += \`<div class="\${classes}" title="\${dateLabel}: \${pointLabel}\${gameLabel}"></div>\`;
                }

                const totalCells = offset + totalDays;
                const trailing = (7 - (totalCells % 7)) % 7;
                for (let i = 0; i < trailing; i++) {
                    html += '<div class="streak-day empty"></div>';
                }

                const minWeeks = 5;
                const minCells = minWeeks * 7;
                const paddedCells = totalCells + trailing;
                const extraCells = Math.max(0, minCells - paddedCells);
                for (let i = 0; i < extraCells; i++) {
                    html += '<div class="streak-day empty"></div>';
                }

                html += '</div>';
                return html;
            }

            // Recent games - works locally
            const recentHtml = games.length
                ? games.slice(-5).reverse().map((game) => {
                    const dateValue = game.playedAt || game.timestamp;
                    const dateLabel = dateValue ? new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                    const wpmValue = typeof game.wpm === 'number' ? game.wpm + ' wpm' : '--';
                    const accuracyValue = typeof game.accuracy === 'number' ? game.accuracy + '%' : '';
                    return \`
                        <div class="recent-item">
                            <span class="recent-wpm">\${wpmValue}</span>
                            <span class="recent-accuracy">\${accuracyValue}</span>
                            <span class="recent-date">\${dateLabel}</span>
                        </div>
                    \`;
                }).join('')
                : '<div class="recent-empty">No sessions yet.</div>';

            const authName = user?.username || user?.displayName || 'User';
            const authMarkup = isAuthenticated && user
                ? \`<div class="stats-auth"><span class="auth-status">Logged in as \${authName}</span><button class="auth-action" onclick="logout()"><span class="auth-icon">\${signOutIcon}</span><span class="auth-highlight">Sign out</span></button></div>\`
                : \`<button class="stats-auth stats-auth-button" type="button" onclick="login()"><span class="auth-icon">\${signInIcon}</span><span><span class="auth-highlight">Sign in</span> to record and view stats</span></button>\`;
            app.innerHTML = \`
                <div class="welcome-shell">
                    <div class="welcome-container">
                        <div class="welcome-header">
                            <div class="welcome-title">CodeType</div>
                            <div class="welcome-subtitle">Type code for fun while vibe coding</div>
                        </div>
                        <div class="welcome-grid">
                            <div class="welcome-column">
                                <div class="welcome-section">
                                    <div class="welcome-section-title">Start</div>
                                    <div class="start-links">
                                        <button class="start-link" onclick="startSolo()">
                                            <span class="start-icon">\${soloIcon}</span>
                                            Solo Game
                                        </button>
                                        <button class="start-link" onclick="showMultiplayerOptions()">
                                            <span class="start-icon">\${teamIcon}</span>
                                            Team Game
                                        </button>
                                    </div>
                                </div>
                                <div class="welcome-section">
                                    <div class="welcome-section-title">Recent</div>
                                    <div class="recent-list">
                                        \${recentHtml}
                                    </div>
                                </div>
                                <div class="welcome-footer">
                                    <span class="footer-author">Created by Nishant Hada</span>
                                    <span class="footer-separator">·</span>
                                    <a href="https://github.com/thisisnsh/codetype" target="_blank" rel="noopener">Star on GitHub</a>
                                    <span class="footer-separator">·</span>
                                    <a href="https://github.com/thisisnsh/codetype/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>
                                    \${isAuthenticated && user
                                        ? \`<span class="footer-separator">·</span><span>Signed in as \${user.username || user.displayName || 'User'}</span><span class="footer-separator">·</span><button onclick="logout()">Sign out</button>\`
                                        : ''}
                                </div>
                            </div>
                            <div class="welcome-column">
                                <div class="welcome-section">
                                    <div class="welcome-section-title">Activity</div>
                                    \${authMarkup}
                                    <div class="stats-grid">
                                        <div class="stat-card">
                                            <div class="stat-card-value">\${gamesPlayedValue}</div>
                                            <div class="stat-card-label">Sessions</div>
                                        </div>
                                        <div class="stat-card">
                                            <div class="stat-card-value">\${avgWpmValue}</div>
                                            <div class="stat-card-label">Avg WPM</div>
                                        </div>
                                        <div class="stat-card">
                                            <div class="stat-card-value">\${bestWpmValue}</div>
                                            <div class="stat-card-label">Best WPM</div>
                                        </div>
                                        <div class="stat-card">
                                            <div class="stat-card-value">\${currentStreakValue}</div>
                                            <div class="stat-card-label">Day Streak</div>
                                        </div>
                                    </div>
                                    <div class="streak-section">
                                        <div class="streak-controls">
                                            <select id="streak-month" class="streak-select">\${buildMonthOptions(streakViewMonth)}</select>
                                            <select id="streak-year" class="streak-select">\${buildYearOptions(streakViewYear)}</select>
                                        </div>
                                        <div class="streak-calendar">
                                            \${generateStreakCalendar()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            \`;
            setupStreakControls();
            scheduleWelcomeOffsetUpdate();
        }

        function requestStatsForYear(year) {
            vscode.postMessage({ type: 'getStats', streakYear: year });
        }

        function ensureStreakDataForYear(year) {
            if (!state.isAuthenticated) {
                return;
            }
            state.streakDataByYear = state.streakDataByYear || {};
            if (!state.streakDataByYear[year]) {
                requestStatsForYear(year);
            }
        }

        function ensureStreakDataForView() {
            ensureStreakDataForYear(streakViewYear);
        }

        function updateStreakView(nextYear, nextMonth) {
            streakViewYear = clampStreakYear(nextYear);
            streakViewMonth = clampStreakMonth(nextMonth);
            ensureStreakDataForView();
            renderWelcome(state.stats, state.isAuthenticated, state.user);
        }

        function setupStreakControls() {
            const monthSelect = document.getElementById('streak-month');
            const yearSelect = document.getElementById('streak-year');

            if (monthSelect) {
                monthSelect.addEventListener('change', (event) => {
                    const value = parseInt(event.target.value, 10);
                    if (!Number.isNaN(value)) {
                        updateStreakView(streakViewYear, value);
                    }
                });
            }

            if (yearSelect) {
                yearSelect.addEventListener('change', (event) => {
                    const value = parseInt(event.target.value, 10);
                    if (!Number.isNaN(value)) {
                        updateStreakView(value, streakViewMonth);
                    }
                });
            }
        }

        function renderLoading(message) {
            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="menu-container">
                    <div style="color: var(--vscode-descriptionForeground);">\${message}</div>
                </div>
            \`;
        }

        function renderEditor(code) {
            state.code = code;
            state.currentPos = 0;
            state.errors = 0;
            state.startTime = null;

            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="editor-header">
                    <div class="editor-header-left">
                        <div class="stats-bar">
                            <div class="stat">
                                <span>WPM:</span>
                                <span class="stat-value" id="wpm">0</span>
                            </div>
                            <div class="stat">
                                <span>Accuracy:</span>
                                <span class="stat-value" id="accuracy">100%</span>
                            </div>
                            <div class="stat">
                                <span>Progress:</span>
                                <span class="stat-value" id="progress">0%</span>
                            </div>
                        </div>
                    </div>
                    <button class="refresh-btn" onclick="refreshCode()" title="Get new code snippet">
                        New Snippet
                    </button>
                </div>
                <div class="editor-container">
                    <div class="line-numbers" id="lineNumbers"></div>
                    <div class="code-area" id="codeArea">
                        <input type="text" class="hidden-input" id="hiddenInput" autofocus />
                        <div id="codeContent"></div>
                    </div>
                </div>
            \`;

            renderCode();
            setupInput();
        }

        function renderCode() {
            const lines = state.code.split('\\n');
            const lineNumbers = document.getElementById('lineNumbers');
            const codeContent = document.getElementById('codeContent');

            lineNumbers.innerHTML = lines.map((_, i) => i + 1).join('<br>');

            let charIndex = 0;
            codeContent.innerHTML = lines.map((line, lineIndex) => {
                const chars = (line + (lineIndex < lines.length - 1 ? '\\n' : '')).split('').map(char => {
                    const idx = charIndex++;
                    let className = 'char pending';
                    if (idx < state.currentPos) {
                        className = 'char correct';
                    } else if (idx === state.currentPos) {
                        className = 'char current';
                    }
                    const displayChar = char === ' ' ? '&nbsp;' :
                                        char === '<' ? '&lt;' :
                                        char === '>' ? '&gt;' :
                                        char === '&' ? '&amp;' :
                                        char === '\\n' ? '↵' : char;
                    return \`<span class="\${className}" data-idx="\${idx}">\${displayChar}</span>\`;
                }).join('');

                const isActive = charIndex > state.currentPos &&
                    (charIndex - line.length - 1) <= state.currentPos;

                return \`<div class="code-line \${isActive ? 'active' : ''}">\${chars}</div>\`;
            }).join('');
        }

        function setupInput() {
            const input = document.getElementById('hiddenInput');
            const codeArea = document.getElementById('codeArea');

            codeArea.addEventListener('click', () => input.focus());
            input.focus();

            input.addEventListener('keydown', (e) => {
                if (state.currentPos >= state.code.length) return;

                if (!state.startTime) {
                    state.startTime = Date.now();
                }

                const expectedChar = state.code[state.currentPos];

                if (e.key === 'Tab') {
                    e.preventDefault();
                    if (expectedChar === ' ') handleChar(' ');
                    return;
                }

                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (expectedChar === '\\n') handleChar('\\n');
                    return;
                }

                if (e.key === 'Backspace') {
                    e.preventDefault();
                    if (state.currentPos > 0) {
                        state.currentPos--;
                        renderCode();
                        updateStats();
                    }
                    return;
                }

                if (e.key.length === 1) {
                    e.preventDefault();
                    handleChar(e.key);
                }
            });
        }

        function handleChar(char) {
            const expectedChar = state.code[state.currentPos];

            if (char === expectedChar) {
                state.currentPos++;
                const charEl = document.querySelector(\`[data-idx="\${state.currentPos - 1}"]\`);
                if (charEl) charEl.className = 'char correct';
                const nextEl = document.querySelector(\`[data-idx="\${state.currentPos}"]\`);
                if (nextEl) nextEl.className = 'char current';
            } else {
                state.errors++;
                const charEl = document.querySelector(\`[data-idx="\${state.currentPos}"]\`);
                if (charEl) {
                    charEl.className = 'char error';
                    setTimeout(() => { charEl.className = 'char current'; }, 150);
                }
            }

            updateStats();

            if (state.currentPos >= state.code.length) {
                finishGame();
            }
        }

        function calculateWPM() {
            if (!state.startTime) return 0;
            const minutes = (Date.now() - state.startTime) / 60000;
            const words = state.currentPos / 5;
            return Math.round(words / minutes) || 0;
        }

        function updateStats() {
            const wpm = calculateWPM();
            const progress = Math.round((state.currentPos / state.code.length) * 100);
            const accuracy = state.currentPos > 0
                ? Math.round((state.currentPos / (state.currentPos + state.errors)) * 100)
                : 100;

            document.getElementById('wpm').textContent = wpm;
            document.getElementById('progress').textContent = progress + '%';
            document.getElementById('accuracy').textContent = accuracy + '%';
        }

        function finishGame() {
            const result = {
                wpm: calculateWPM(),
                accuracy: Math.round((state.currentPos / (state.currentPos + state.errors)) * 100),
                time: (Date.now() - state.startTime) / 1000,
                characters: state.code.length,
                errors: state.errors
            };
            vscode.postMessage({ type: 'gameFinished', result });
        }

        function renderResults(result, stats) {
            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="results-overlay">
                    <div class="results-card">
                        <div class="results-wpm">\${result.wpm}</div>
                        <div class="results-label">Words Per Minute</div>
                        <div class="results-stats">
                            <div class="result-stat">
                                <div class="result-stat-value">\${result.accuracy}%</div>
                                <div class="result-stat-label">Accuracy</div>
                            </div>
                            <div class="result-stat">
                                <div class="result-stat-value">\${result.time.toFixed(1)}s</div>
                                <div class="result-stat-label">Time</div>
                            </div>
                            <div class="result-stat">
                                <div class="result-stat-value">\${result.errors}</div>
                                <div class="result-stat-label">Errors</div>
                            </div>
                        </div>
                        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border);">
                            <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 8px;">Your Stats</div>
                            <div style="display: flex; gap: 20px; justify-content: flex-start;">
                                <div style="text-align: left;">
                                    <div style="color: var(--vscode-textLink-foreground);">\${stats.avgWpm}</div>
                                    <div style="color: var(--vscode-descriptionForeground); font-size: 10px;">Avg WPM</div>
                                </div>
                                <div style="text-align: left;">
                                    <div style="color: var(--vscode-textLink-foreground);">\${stats.bestWpm}</div>
                                    <div style="color: var(--vscode-descriptionForeground); font-size: 10px;">Best WPM</div>
                                </div>
                                <div style="text-align: left;">
                                    <div style="color: var(--vscode-textLink-foreground);">\${stats.gamesPlayed}</div>
                                    <div style="color: var(--vscode-descriptionForeground); font-size: 10px;">Sessions</div>
                                </div>
                            </div>
                        </div>
                        <div class="menu-buttons" style="margin-top: 20px; width: auto;">
                            <button class="menu-btn menu-btn-primary" onclick="startSolo()">Play Again</button>
                            <button class="menu-btn" onclick="goToMenu()">My Stats</button>
                        </div>
                    </div>
                </div>
            \`;
        }

        function renderStats(data, isAuthenticated, user) {
            renderWelcome(data, isAuthenticated, user);
        }

        function renderStreakHeatmap(activities) {
            const today = new Date();
            const startDate = new Date(today.getFullYear(), 0, 1);
            const days = [];
            const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            // Generate all days of the year
            const current = new Date(startDate);
            while (current <= today) {
                const dateStr = current.toISOString().split('T')[0];
                const activity = activities[dateStr];
                const games = activity ? activity.gamesPlayed : 0;
                days.push({
                    date: dateStr,
                    dayOfWeek: current.getDay(),
                    month: current.getMonth(),
                    games: games
                });
                current.setDate(current.getDate() + 1);
            }

            // Group by weeks
            const weeks = [];
            let currentWeek = [];
            // Pad the first week
            const firstDayOfWeek = days[0]?.dayOfWeek || 0;
            for (let i = 0; i < firstDayOfWeek; i++) {
                currentWeek.push(null);
            }
            days.forEach(day => {
                currentWeek.push(day);
                if (day.dayOfWeek === 6) {
                    weeks.push(currentWeek);
                    currentWeek = [];
                }
            });
            if (currentWeek.length > 0) {
                weeks.push(currentWeek);
            }

            // Get color for activity level
            function getColor(games) {
                if (games === 0) return '#2d333b';
                if (games <= 2) return '#0e4429';
                if (games <= 5) return '#006d32';
                if (games <= 9) return '#26a641';
                return '#39d353';
            }

            // Build SVG
            const cellSize = 11;
            const cellGap = 3;
            const leftPadding = 30;
            const topPadding = 20;
            const width = leftPadding + weeks.length * (cellSize + cellGap);
            const height = topPadding + 7 * (cellSize + cellGap) + 10;

            let svg = \`<svg width="\${width}" height="\${height}" style="font-size: 10px; font-family: inherit;">\`;

            // Day labels
            dayLabels.forEach((label, i) => {
                if (i % 2 === 1) {
                    svg += \`<text x="0" y="\${topPadding + i * (cellSize + cellGap) + cellSize - 2}" fill="var(--vscode-descriptionForeground)">\${label}</text>\`;
                }
            });

            // Month labels
            let lastMonth = -1;
            weeks.forEach((week, weekIndex) => {
                const firstDay = week.find(d => d !== null);
                if (firstDay && firstDay.month !== lastMonth && firstDay.dayOfWeek <= 3) {
                    lastMonth = firstDay.month;
                    svg += \`<text x="\${leftPadding + weekIndex * (cellSize + cellGap)}" y="12" fill="var(--vscode-descriptionForeground)">\${monthLabels[firstDay.month]}</text>\`;
                }
            });

            // Cells
            weeks.forEach((week, weekIndex) => {
                week.forEach((day, dayIndex) => {
                    if (day) {
                        const x = leftPadding + weekIndex * (cellSize + cellGap);
                        const y = topPadding + dayIndex * (cellSize + cellGap);
                        const color = getColor(day.games);
                        svg += \`<rect x="\${x}" y="\${y}" width="\${cellSize}" height="\${cellSize}" rx="2" fill="\${color}" title="\${day.date}: \${day.games} games"><title>\${day.date}: \${day.games} games</title></rect>\`;
                    }
                });
            });

            svg += '</svg>';

            // Legend
            const legend = \`
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px; justify-content: flex-start;">
                    <span style="color: var(--vscode-descriptionForeground); font-size: 10px;">Less</span>
                    <div style="display: flex; gap: 2px;">
                        <div style="width: 11px; height: 11px; background: #2d333b; border-radius: 2px;"></div>
                        <div style="width: 11px; height: 11px; background: #0e4429; border-radius: 2px;"></div>
                        <div style="width: 11px; height: 11px; background: #006d32; border-radius: 2px;"></div>
                        <div style="width: 11px; height: 11px; background: #26a641; border-radius: 2px;"></div>
                        <div style="width: 11px; height: 11px; background: #39d353; border-radius: 2px;"></div>
                    </div>
                    <span style="color: var(--vscode-descriptionForeground); font-size: 10px;">More</span>
                </div>
            \`;

            return svg + legend;
        }

        function goToMenu() {
            showWelcome();
        }

        function startSolo() {
            state.mode = 'solo';
            vscode.postMessage({ type: 'startSolo' });
            renderLoading('Preparing code...');
        }

        function refreshCode() {
            vscode.postMessage({ type: 'refreshCode' });
            renderLoading('Loading new snippet...');
        }

        function showWelcome() {
            state.mode = 'menu';
            ensureStreakDataForView();
            renderWelcome(state.stats, state.isAuthenticated, state.user);
        }

        function login() {
            vscode.postMessage({ type: 'login' });
        }

        function logout() {
            vscode.postMessage({ type: 'logout' });
        }

        // Multiplayer functions
        function showMultiplayerOptions() {
            state.mode = 'team';
            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="menu-container">
                    <div class="menu-title">Team Game</div>
                    <div class="menu-subtitle">Race against your team!</div>

                    <div style="margin-bottom: 24px;">
                        <label style="color: var(--vscode-descriptionForeground); font-size: 12px; display: block; margin-bottom: 8px;">Your display name:</label>
                        <input type="text" id="displayNameInput" value="\${state.displayName}"
                            style="background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); color: var(--vscode-input-foreground); padding: 8px 12px; font-family: inherit; font-size: 14px; width: 200px; border-radius: 2px;"
                            placeholder="Enter your name" />
                    </div>

                    <div class="menu-buttons">
                        <button class="menu-btn menu-btn-primary" onclick="createRoom()">Create Room</button>
                    </div>

                    <div style="margin-top: 32px; text-align: left;">
                        <div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px;">Or join an existing room:</div>
                        <div class="join-room-input">
                            <input type="text" id="roomCodeInput" placeholder="CODE" maxlength="6" />
                            <button class="menu-btn menu-btn-primary" onclick="joinRoom()">Join</button>
                        </div>
                    </div>
                </div>
            \`;
        }

        function createRoom() {
            const displayNameInput = document.getElementById('displayNameInput');
            state.displayName = displayNameInput?.value || 'Player';
            vscode.postMessage({ type: 'createRoom', displayName: state.displayName });
            renderLoading('Creating room...');
        }

        function joinRoom() {
            const roomCodeInput = document.getElementById('roomCodeInput');
            const displayNameInput = document.getElementById('displayNameInput');
            const roomCode = roomCodeInput?.value?.toUpperCase();
            state.displayName = displayNameInput?.value || 'Player';

            if (!roomCode || roomCode.length !== 6) {
                alert('Please enter a valid 6-character room code');
                return;
            }

            vscode.postMessage({ type: 'joinRoom', roomCode, displayName: state.displayName });
            renderLoading('Joining room...');
        }

        function connectToRoom(roomCode, wsUrl, userId) {
            state.roomCode = roomCode;
            state.userId = userId;

            try {
                state.wsConnection = new WebSocket(wsUrl);

                state.wsConnection.onopen = () => {
                    console.log('Connected to room');
                };

                state.wsConnection.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    handleWsMessage(message);
                };

                state.wsConnection.onclose = () => {
                    console.log('Disconnected from room');
                    if (state.mode === 'lobby' || state.mode === 'multiplayer') {
                        state.wsConnection = null;
                        goToMenu();
                    }
                };

                state.wsConnection.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    alert('Connection error. Please try again.');
                    goToMenu();
                };
            } catch (error) {
                console.error('Failed to connect:', error);
                alert('Failed to connect to room');
                goToMenu();
            }
        }

        function handleWsMessage(message) {
            switch (message.type) {
                case 'joined':
                    state.isHost = message.data.isHost;
                    state.players = message.data.players;
                    state.mode = 'lobby';
                    renderLobby();
                    break;

                case 'playerJoined':
                case 'playerLeft':
                    state.players = message.data.players;
                    if (state.mode === 'lobby') {
                        renderLobby();
                    }
                    break;

                case 'countdown':
                    state.countdownValue = message.data.count;
                    renderCountdown(message.data.count);
                    break;

                case 'gameStart':
                    state.code = message.data.codeSnippet;
                    state.currentPos = 0;
                    state.errors = 0;
                    state.startTime = Date.now();
                    state.countdownValue = null;
                    state.mode = 'multiplayer';
                    renderMultiplayerGame();
                    break;

                case 'progress':
                    state.players = message.data.players;
                    updatePlayersProgress();
                    break;

                case 'playerFinished':
                    // Update player in list
                    const finishedPlayer = state.players.find(p => p.userId === message.data.userId);
                    if (finishedPlayer) {
                        finishedPlayer.finished = true;
                        finishedPlayer.wpm = message.data.wpm;
                    }
                    updatePlayersProgress();
                    break;

                case 'gameEnd':
                    state.multiplayerResults = message.data.results;
                    renderMultiplayerResults();
                    break;

                case 'reset':
                    state.players = message.data.players;
                    state.code = '';
                    state.currentPos = 0;
                    state.errors = 0;
                    state.startTime = null;
                    state.mode = 'lobby';
                    renderLobby();
                    break;
            }
        }

        function renderLobby() {
            const app = document.getElementById('app');
            const inviteUrl = window.location.origin + '?room=' + state.roomCode;

            const playersHtml = state.players.map(p => \`
                <div class="player-item">
                    <div class="player-avatar">\${p.username.charAt(0).toUpperCase()}</div>
                    <span class="player-name">\${p.username}</span>
                    \${p.isHost ? '<span class="player-host">HOST</span>' : ''}
                </div>
            \`).join('');

            app.innerHTML = \`
                <div class="lobby-container">
                    <div style="color: var(--vscode-descriptionForeground); font-size: 12px;">Room Code</div>
                    <div class="room-code">\${state.roomCode}</div>

                    <div class="invite-link">
                        <span style="color: var(--vscode-descriptionForeground);">Share this code with colleagues to invite them!</span>
                    </div>

                    <div style="margin-top: 16px;">
                        <div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 8px;">Players (\${state.players.length})</div>
                        <div class="players-list">
                            \${playersHtml}
                        </div>
                    </div>

                    \${state.isHost ? \`
                        <button class="menu-btn menu-btn-primary" onclick="startMultiplayerGame()" style="margin-top: 24px; width: 200px; justify-content: center;" \${state.players.length < 1 ? 'disabled' : ''}>
                            Start Game
                        </button>
                        <div style="color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 8px;">
                            \${state.players.length < 2 ? 'Waiting for more players...' : 'Ready to start!'}
                        </div>
                    \` : \`
                        <div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 24px;">
                            Waiting for host to start the game...
                        </div>
                    \`}
                </div>
            \`;
        }

        function renderCountdown(count) {
            let overlay = document.getElementById('countdownOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'countdownOverlay';
                overlay.className = 'countdown-overlay';
                document.body.appendChild(overlay);
            }
            overlay.innerHTML = \`<div class="countdown-number">\${count}</div>\`;
        }

        function startMultiplayerGame() {
            if (!state.isHost || !state.wsConnection) return;

            vscode.postMessage({ type: 'getCodeForMultiplayer' });
        }

        function sendGameStart(codeSnippet) {
            if (state.wsConnection) {
                state.wsConnection.send(JSON.stringify({
                    type: 'start',
                    data: { codeSnippet }
                }));
            }
        }

        function renderMultiplayerGame() {
            // Remove countdown overlay if exists
            const overlay = document.getElementById('countdownOverlay');
            if (overlay) overlay.remove();

            const app = document.getElementById('app');

            const playersHtml = state.players.map(p => \`
                <div class="player-item" id="player-\${p.userId}">
                    <div class="player-avatar">\${p.username.charAt(0).toUpperCase()}</div>
                    <span class="player-name">\${p.username}</span>
                    <div class="player-progress">
                        <div class="player-progress-fill" style="width: \${p.progress || 0}%"></div>
                    </div>
                    <span class="player-wpm">\${p.wpm || 0} WPM</span>
                </div>
            \`).join('');

            app.innerHTML = \`
                <div class="editor-header">
                    <div class="editor-header-left">
                        <div class="stats-bar">
                            <div class="stat">
                                <span>WPM:</span>
                                <span class="stat-value" id="wpm">0</span>
                            </div>
                            <div class="stat">
                                <span>Progress:</span>
                                <span class="stat-value" id="progress">0%</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="padding: 8px 16px; border-bottom: 1px solid var(--vscode-panel-border);">
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        \${playersHtml}
                    </div>
                </div>
                <div class="editor-container">
                    <div class="line-numbers" id="lineNumbers"></div>
                    <div class="code-area" id="codeArea">
                        <input type="text" class="hidden-input" id="hiddenInput" autofocus />
                        <div id="codeContent"></div>
                    </div>
                </div>
            \`;

            renderCode();
            setupMultiplayerInput();
        }

        function setupMultiplayerInput() {
            const input = document.getElementById('hiddenInput');
            const codeArea = document.getElementById('codeArea');

            codeArea.addEventListener('click', () => input.focus());
            input.focus();

            input.addEventListener('keydown', (e) => {
                if (state.currentPos >= state.code.length) return;

                const expectedChar = state.code[state.currentPos];

                if (e.key === 'Tab') {
                    e.preventDefault();
                    if (expectedChar === ' ') handleMultiplayerChar(' ');
                    return;
                }

                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (expectedChar === '\\n') handleMultiplayerChar('\\n');
                    return;
                }

                if (e.key === 'Backspace') {
                    e.preventDefault();
                    if (state.currentPos > 0) {
                        state.currentPos--;
                        renderCode();
                        sendProgress();
                    }
                    return;
                }

                if (e.key.length === 1) {
                    e.preventDefault();
                    handleMultiplayerChar(e.key);
                }
            });
        }

        function handleMultiplayerChar(char) {
            const expectedChar = state.code[state.currentPos];

            if (char === expectedChar) {
                state.currentPos++;
                const charEl = document.querySelector(\`[data-idx="\${state.currentPos - 1}"]\`);
                if (charEl) charEl.className = 'char correct';
                const nextEl = document.querySelector(\`[data-idx="\${state.currentPos}"]\`);
                if (nextEl) nextEl.className = 'char current';
            } else {
                state.errors++;
                const charEl = document.querySelector(\`[data-idx="\${state.currentPos}"]\`);
                if (charEl) {
                    charEl.className = 'char error';
                    setTimeout(() => { charEl.className = 'char current'; }, 150);
                }
            }

            updateMultiplayerStats();
            sendProgress();

            if (state.currentPos >= state.code.length) {
                finishMultiplayerGame();
            }
        }

        function updateMultiplayerStats() {
            const wpm = calculateWPM();
            const progress = Math.round((state.currentPos / state.code.length) * 100);

            document.getElementById('wpm').textContent = wpm;
            document.getElementById('progress').textContent = progress + '%';
        }

        function sendProgress() {
            if (state.wsConnection) {
                const progress = Math.round((state.currentPos / state.code.length) * 100);
                const wpm = calculateWPM();
                state.wsConnection.send(JSON.stringify({
                    type: 'progress',
                    data: { progress, wpm }
                }));
            }
        }

        function finishMultiplayerGame() {
            const wpm = calculateWPM();
            if (state.wsConnection) {
                state.wsConnection.send(JSON.stringify({
                    type: 'finish',
                    data: { wpm }
                }));
            }
        }

        function updatePlayersProgress() {
            state.players.forEach(p => {
                const playerEl = document.getElementById(\`player-\${p.userId}\`);
                if (playerEl) {
                    const progressFill = playerEl.querySelector('.player-progress-fill');
                    const wpmEl = playerEl.querySelector('.player-wpm');
                    if (progressFill) progressFill.style.width = (p.progress || 0) + '%';
                    if (wpmEl) wpmEl.textContent = (p.wpm || 0) + ' WPM';
                }
            });
        }

        function renderMultiplayerResults() {
            const app = document.getElementById('app');
            const results = state.multiplayerResults || [];

            const resultsHtml = results.map((r, i) => {
                const placeClass = i === 0 ? 'first' : i === 1 ? 'second' : i === 2 ? 'third' : '';
                return \`
                    <div class="result-place \${placeClass}">
                        <span class="result-rank \${placeClass}">#\${i + 1}</span>
                        <div class="player-avatar">\${r.username.charAt(0).toUpperCase()}</div>
                        <span class="player-name" style="flex: 1;">\${r.username}</span>
                        <span style="color: var(--vscode-textLink-foreground); font-size: 18px; font-weight: bold;">\${r.wpm} WPM</span>
                    </div>
                \`;
            }).join('');

            app.innerHTML = \`
                <div class="menu-container">
                    <div class="menu-title">Race Results</div>
                    <div class="multiplayer-results">
                        \${resultsHtml}
                    </div>
                    <div class="menu-buttons" style="margin-top: 24px;">
                        \${state.isHost ? \`
                            <button class="menu-btn menu-btn-primary" onclick="waitForReset()">Play Again</button>
                        \` : ''}
                        <button class="menu-btn" onclick="leaveLobby()">Leave Room</button>
                    </div>
                </div>
            \`;
        }

        function waitForReset() {
            renderLoading('Starting new game...');
        }

        function leaveLobby() {
            if (state.wsConnection) {
                state.wsConnection.close();
                state.wsConnection = null;
            }
            state.roomCode = null;
            state.players = [];
            state.isHost = false;
            goToMenu();
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'loadCode':
                    state.mode = 'playing';
                    renderEditor(message.code);
                    break;
                case 'showResults':
                    renderResults(message.result, message.stats);
                    break;
                case 'stats':
                    state.isAuthenticated = message.isAuthenticated;
                    state.user = message.user;
                    state.stats = message.data;
                    if (!message.isAuthenticated) {
                        state.streakDataByYear = {};
                    } else if (message.data && typeof message.data.streakYear === 'number') {
                        state.streakDataByYear = state.streakDataByYear || {};
                        state.streakDataByYear[message.data.streakYear] = message.data.streakData || { activities: {} };
                    }
                    renderStats(message.data, message.isAuthenticated, message.user);
                    break;
                case 'error':
                    alert(message.message);
                    goToMenu();
                    break;

                case 'roomCreated':
                    connectToRoom(message.roomCode, message.wsUrl, message.userId);
                    break;

                case 'roomJoined':
                    connectToRoom(message.roomCode, message.wsUrl, message.userId);
                    break;

                case 'multiplayerCode':
                    sendGameStart(message.code);
                    break;
            }
        });

        init();
        `;
    }

    public dispose() {
        CodeTypePanel._panels.delete(this);
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
