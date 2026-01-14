import * as vscode from 'vscode';
import { ApiClient } from '../api';
import { CodeSampleProvider } from '../codeSamples';
import { AuthService } from '../auth';

type GameMode = 'menu' | 'solo' | 'leaderboard' | 'stats' | 'playing';

export class CodeTypePanel {
    public static currentPanel: CodeTypePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private readonly _api: ApiClient;
    private readonly _codeSamples: CodeSampleProvider;
    private readonly _authService: AuthService;
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

        if (CodeTypePanel.currentPanel) {
            CodeTypePanel.currentPanel._panel.reveal(column);
            CodeTypePanel.currentPanel.setMode(mode);
            return;
        }

        // Create a new panel that looks like a regular editor
        const panel = vscode.window.createWebviewPanel(
            'codeType',
            'utils.ts', // Stealth name - looks like a normal file!
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        CodeTypePanel.currentPanel = new CodeTypePanel(panel, extensionUri, context, api, codeSamples, authService, mode);
    }

    public static refresh() {
        if (CodeTypePanel.currentPanel) {
            CodeTypePanel.currentPanel._update();
        }
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        api: ApiClient,
        codeSamples: CodeSampleProvider,
        authService: AuthService,
        mode: GameMode
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        this._api = api;
        this._codeSamples = codeSamples;
        this._authService = authService;
        this._currentMode = mode;

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

            case 'getLeaderboard':
                const leaderboard = await this._api.getLeaderboard(message.timeframe || 'weekly');
                this._panel.webview.postMessage({ type: 'leaderboard', data: leaderboard, timeframe: message.timeframe });
                break;

            case 'getStats':
                const userStats = await this._api.getUserStats();
                const streakData = await this._api.getStreakData();
                const recentGames = await this._api.getRecentGames();
                this._panel.webview.postMessage({
                    type: 'stats',
                    data: {
                        ...userStats,
                        games: recentGames,
                        streakData
                    },
                    isAuthenticated: this._api.isAuthenticated(),
                    user: this._api.getCurrentUser()
                });
                break;

            case 'login':
                vscode.commands.executeCommand('codetype.login');
                break;

            case 'logout':
                vscode.commands.executeCommand('codetype.logout');
                break;

            case 'navigate':
                this.setMode(message.mode);
                break;
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        const config = vscode.workspace.getConfiguration('codetype');
        const username = config.get<string>('username') || 'Anonymous';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>utils.ts</title>
    <style>
        ${this._getStyles()}
    </style>
</head>
<body>
    <div id="app">
        ${this._getInitialContent()}
    </div>
    <script>
        ${this._getScript(username)}
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
            font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', Consolas, monospace);
            font-size: var(--vscode-editor-font-size, 14px);
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

        .file-path {
            color: var(--vscode-descriptionForeground);
        }

        .stats-bar {
            display: flex;
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
            align-items: center;
            justify-content: center;
            height: 100%;
            gap: 20px;
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

        .menu-btn .icon {
            font-size: 16px;
            opacity: 0.8;
        }

        .menu-btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }

        .menu-btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
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
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 20px;
            z-index: 100;
        }

        .results-card {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
            padding: 28px 40px;
            text-align: center;
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

        /* Leaderboard */
        .leaderboard-container {
            padding: 20px;
            max-width: 600px;
            margin: 0 auto;
        }

        .leaderboard-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .leaderboard-tab {
            padding: 6px 12px;
            background: var(--vscode-button-secondaryBackground);
            border: none;
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            font-family: inherit;
            font-size: 12px;
            border-radius: 2px;
        }

        .leaderboard-tab.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .leaderboard-entry {
            display: flex;
            align-items: center;
            padding: 10px 14px;
            background: var(--vscode-editorWidget-background);
            margin: 3px 0;
            border-radius: 2px;
        }

        .leaderboard-rank {
            width: 36px;
            font-size: 16px;
            font-weight: bold;
            color: var(--vscode-descriptionForeground);
        }

        .leaderboard-rank.top1 { color: #ffd700; }
        .leaderboard-rank.top2 { color: #c0c0c0; }
        .leaderboard-rank.top3 { color: #cd7f32; }

        .leaderboard-name {
            flex: 1;
            color: var(--vscode-editor-foreground);
        }

        .leaderboard-wpm {
            font-size: 16px;
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
        }

        /* Back button */
        .back-btn {
            position: absolute;
            top: 12px;
            left: 12px;
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 4px;
            font-family: inherit;
        }

        .back-btn:hover {
            color: var(--vscode-editor-foreground);
        }

        .section-title {
            color: var(--vscode-textLink-foreground);
            margin-bottom: 16px;
            font-size: 18px;
        }
    `;
    }

    private _getInitialContent() {
        return `<div class="loading">Loading...</div>`;
    }

    private _getScript(username: string) {
        const isAuthenticated = this._authService.isAuthenticated();
        const currentUser = this._authService.getCurrentUser();
        const userJson = currentUser ? JSON.stringify(currentUser) : 'null';

        return `
        const vscode = acquireVsCodeApi();
        const state = {
            mode: '${this._currentMode}',
            username: '${username}',
            code: '',
            currentPos: 0,
            startTime: null,
            errors: 0,
            currentTimeframe: 'weekly',
            isAuthenticated: ${isAuthenticated},
            user: ${userJson},
            streakData: null
        };

        function init() {
            switch(state.mode) {
                case 'menu':
                    renderMenu();
                    break;
                case 'solo':
                    vscode.postMessage({ type: 'startSolo' });
                    renderLoading('Preparing code...');
                    break;
                case 'leaderboard':
                    vscode.postMessage({ type: 'getLeaderboard', timeframe: 'weekly' });
                    renderLoading('Loading leaderboard...');
                    break;
                case 'stats':
                    vscode.postMessage({ type: 'getStats' });
                    renderLoading('Loading stats...');
                    break;
            }
        }

        function renderMenu() {
            const app = document.getElementById('app');
            const userDisplay = state.isAuthenticated && state.user
                ? \`<div style="display: flex; align-items: center; gap: 10px;">
                    \${state.user.photoURL ? \`<img src="\${state.user.photoURL}" style="width: 32px; height: 32px; border-radius: 50%;" />\` : ''}
                    <div>
                        <div style="color: var(--vscode-textLink-foreground);">\${state.user.username || state.user.displayName}</div>
                        <div style="font-size: 10px; color: var(--vscode-descriptionForeground);">\${state.user.currentStreak || 0} day streak</div>
                    </div>
                </div>\`
                : \`<div style="color: var(--vscode-descriptionForeground);">Playing as: <span style="color: var(--vscode-textLink-foreground);">\${state.username}</span></div>\`;

            const authButton = state.isAuthenticated
                ? \`<button class="menu-btn" onclick="logout()">
                    <span class="icon">⏻</span>
                    <span>Sign Out</span>
                </button>\`
                : \`<button class="menu-btn" onclick="login()">
                    <span class="icon">→</span>
                    <span>Sign In</span>
                </button>\`;

            app.innerHTML = \`
                <div class="menu-container">
                    <div class="menu-title">CodeType</div>
                    <div class="menu-subtitle">Typing practice for developers</div>
                    <div class="menu-buttons">
                        <button class="menu-btn menu-btn-primary" onclick="startSolo()">
                            <span class="icon">▶</span>
                            <span>Start Practice</span>
                        </button>
                        <button class="menu-btn" onclick="showLeaderboard()">
                            <span class="icon">◆</span>
                            <span>Leaderboard</span>
                        </button>
                        <button class="menu-btn" onclick="showStats()">
                            <span class="icon">≡</span>
                            <span>My Stats</span>
                        </button>
                        \${authButton}
                    </div>
                    <div style="margin-top: 24px; font-size: 11px;">
                        \${userDisplay}
                    </div>
                </div>
            \`;
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
                    <span class="file-path">practice.ts</span>
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
                            <div style="display: flex; gap: 20px; justify-content: center;">
                                <div style="text-align: center;">
                                    <div style="color: var(--vscode-textLink-foreground);">\${stats.avgWpm}</div>
                                    <div style="color: var(--vscode-descriptionForeground); font-size: 10px;">Avg WPM</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="color: var(--vscode-textLink-foreground);">\${stats.bestWpm}</div>
                                    <div style="color: var(--vscode-descriptionForeground); font-size: 10px;">Best WPM</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="color: var(--vscode-textLink-foreground);">\${stats.gamesPlayed}</div>
                                    <div style="color: var(--vscode-descriptionForeground); font-size: 10px;">Sessions</div>
                                </div>
                            </div>
                        </div>
                        <div class="menu-buttons" style="margin-top: 20px; width: auto;">
                            <button class="menu-btn menu-btn-primary" onclick="startSolo()">Practice Again</button>
                            <button class="menu-btn" onclick="goToMenu()">Menu</button>
                        </div>
                    </div>
                </div>
            \`;
        }

        function renderLeaderboard(data, timeframe) {
            state.currentTimeframe = timeframe;
            const app = document.getElementById('app');
            app.innerHTML = \`
                <button class="back-btn" onclick="goToMenu()">← Back</button>
                <div class="leaderboard-container">
                    <h2 class="section-title">Leaderboard</h2>
                    <div class="leaderboard-tabs">
                        <button class="leaderboard-tab \${timeframe === 'daily' ? 'active' : ''}"
                            onclick="loadLeaderboard('daily')">Daily</button>
                        <button class="leaderboard-tab \${timeframe === 'weekly' ? 'active' : ''}"
                            onclick="loadLeaderboard('weekly')">Weekly</button>
                        <button class="leaderboard-tab \${timeframe === 'monthly' ? 'active' : ''}"
                            onclick="loadLeaderboard('monthly')">Monthly</button>
                        <button class="leaderboard-tab \${timeframe === 'yearly' ? 'active' : ''}"
                            onclick="loadLeaderboard('yearly')">Yearly</button>
                        <button class="leaderboard-tab \${timeframe === 'alltime' ? 'active' : ''}"
                            onclick="loadLeaderboard('alltime')">All Time</button>
                    </div>
                    \${data.length === 0 ? \`
                        <div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 40px;">
                            No entries yet. Be the first!
                        </div>
                    \` : data.map((entry, i) => \`
                        <div class="leaderboard-entry">
                            <span class="leaderboard-rank \${i < 3 ? 'top' + (i+1) : ''}">#\${i + 1}</span>
                            <span class="leaderboard-name">\${entry.username}</span>
                            <span class="leaderboard-wpm">\${entry.avgWpm} WPM</span>
                        </div>
                    \`).join('')}
                </div>
            \`;
        }

        function renderStats(data, isAuthenticated, user) {
            state.streakData = data.streakData;
            const avgWpm = data.avgWpm || (data.totalGamesPlayed > 0 ? Math.round(data.totalWpm / data.totalGamesPlayed) : 0);
            const gamesPlayed = data.totalGamesPlayed || data.gamesPlayed || 0;
            const bestWpm = data.bestWpm || 0;
            const currentStreak = data.currentStreak || 0;
            const longestStreak = data.longestStreak || 0;
            const games = data.games || [];

            const streakHeatmap = state.streakData && state.streakData.activities
                ? renderStreakHeatmap(state.streakData.activities)
                : (isAuthenticated
                    ? '<div style="color: var(--vscode-descriptionForeground); text-align: center; padding: 20px;">No activity data yet. Start practicing!</div>'
                    : '<div style="color: var(--vscode-descriptionForeground); text-align: center; padding: 20px;">Sign in to track your activity streak!</div>');

            const app = document.getElementById('app');
            app.innerHTML = \`
                <button class="back-btn" onclick="goToMenu()">← Back</button>
                <div class="leaderboard-container" style="max-width: 800px;">
                    <h2 class="section-title">My Stats</h2>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px;">
                        <div style="background: var(--vscode-editorWidget-background); padding: 20px; text-align: center; border-radius: 4px;">
                            <div style="font-size: 28px; color: var(--vscode-textLink-foreground);">\${gamesPlayed}</div>
                            <div style="color: var(--vscode-descriptionForeground); font-size: 11px;">Sessions</div>
                        </div>
                        <div style="background: var(--vscode-editorWidget-background); padding: 20px; text-align: center; border-radius: 4px;">
                            <div style="font-size: 28px; color: var(--vscode-textLink-foreground);">\${avgWpm}</div>
                            <div style="color: var(--vscode-descriptionForeground); font-size: 11px;">Avg WPM</div>
                        </div>
                        <div style="background: var(--vscode-editorWidget-background); padding: 20px; text-align: center; border-radius: 4px;">
                            <div style="font-size: 28px; color: var(--vscode-textLink-foreground);">\${bestWpm}</div>
                            <div style="color: var(--vscode-descriptionForeground); font-size: 11px;">Best WPM</div>
                        </div>
                        <div style="background: var(--vscode-editorWidget-background); padding: 20px; text-align: center; border-radius: 4px;">
                            <div style="font-size: 28px; color: #39d353;">\${currentStreak}</div>
                            <div style="color: var(--vscode-descriptionForeground); font-size: 11px;">Day Streak</div>
                        </div>
                    </div>

                    <h3 style="color: var(--vscode-descriptionForeground); margin-bottom: 12px; font-size: 13px;">Activity</h3>
                    <div style="background: var(--vscode-editorWidget-background); padding: 16px; border-radius: 4px; margin-bottom: 24px; overflow-x: auto;">
                        \${streakHeatmap}
                    </div>

                    <h3 style="color: var(--vscode-descriptionForeground); margin-bottom: 12px; font-size: 13px;">Recent Sessions</h3>
                    \${games.slice(-10).reverse().map(g => \`
                        <div class="leaderboard-entry">
                            <span style="color: var(--vscode-descriptionForeground); font-size: 11px; width: 90px;">
                                \${new Date(g.playedAt || g.timestamp).toLocaleDateString()}
                            </span>
                            <span style="flex: 1;">\${g.wpm} WPM</span>
                            <span style="color: var(--vscode-descriptionForeground);">\${g.accuracy}%</span>
                        </div>
                    \`).join('') || '<div style="color: var(--vscode-descriptionForeground);">No sessions yet</div>'}
                </div>
            \`;
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
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px; justify-content: flex-end;">
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
            state.mode = 'menu';
            renderMenu();
        }

        function startSolo() {
            state.mode = 'solo';
            vscode.postMessage({ type: 'startSolo' });
            renderLoading('Preparing code...');
        }

        function showLeaderboard() {
            state.mode = 'leaderboard';
            vscode.postMessage({ type: 'getLeaderboard', timeframe: 'weekly' });
            renderLoading('Loading leaderboard...');
        }

        function loadLeaderboard(timeframe) {
            vscode.postMessage({ type: 'getLeaderboard', timeframe });
        }

        function showStats() {
            state.mode = 'stats';
            vscode.postMessage({ type: 'getStats' });
            renderLoading('Loading stats...');
        }

        function login() {
            vscode.postMessage({ type: 'login' });
        }

        function logout() {
            vscode.postMessage({ type: 'logout' });
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
                case 'leaderboard':
                    renderLeaderboard(message.data, message.timeframe || state.currentTimeframe);
                    break;
                case 'stats':
                    renderStats(message.data, message.isAuthenticated, message.user);
                    break;
                case 'error':
                    alert(message.message);
                    goToMenu();
                    break;
            }
        });

        init();
        `;
    }

    public dispose() {
        CodeTypePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
