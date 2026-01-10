import * as vscode from 'vscode';
import { ApiClient } from '../api';
import { CodeSampleProvider } from '../codeSamples';

type GameMode = 'menu' | 'solo' | 'create-room' | 'join-room' | 'leaderboard' | 'stats' | 'playing' | 'multiplayer-lobby' | 'multiplayer-playing';

export class CodeTypePanel {
    public static currentPanel: CodeTypePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private readonly _api: ApiClient;
    private readonly _codeSamples: CodeSampleProvider;
    private _disposables: vscode.Disposable[] = [];
    private _currentMode: GameMode = 'menu';
    private _roomCode: string = '';

    public static createOrShow(
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        api: ApiClient,
        codeSamples: CodeSampleProvider,
        mode: GameMode,
        roomCode?: string
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CodeTypePanel.currentPanel) {
            CodeTypePanel.currentPanel._panel.reveal(column);
            CodeTypePanel.currentPanel.setMode(mode, roomCode);
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

        CodeTypePanel.currentPanel = new CodeTypePanel(panel, extensionUri, context, api, codeSamples, mode, roomCode);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        api: ApiClient,
        codeSamples: CodeSampleProvider,
        mode: GameMode,
        roomCode?: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        this._api = api;
        this._codeSamples = codeSamples;
        this._currentMode = mode;
        this._roomCode = roomCode || '';

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

    public setMode(mode: GameMode, roomCode?: string) {
        this._currentMode = mode;
        this._roomCode = roomCode || '';
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
                // Store locally too
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

            case 'createRoom':
                try {
                    const roomCode = await this._api.createRoom();
                    this._roomCode = roomCode;
                    this._connectToRoom(roomCode);
                    this._panel.webview.postMessage({ type: 'roomCreated', roomCode });
                } catch (e) {
                    this._panel.webview.postMessage({ type: 'error', message: 'Failed to create room' });
                }
                break;

            case 'joinRoom':
                this._connectToRoom(message.roomCode);
                break;

            case 'startMultiplayer':
                const multiCode = await this._codeSamples.getRandomSample(true);
                this._api.startGame(multiCode);
                break;

            case 'updateProgress':
                this._api.updateProgress(message.progress, message.wpm);
                break;

            case 'multiplayerFinished':
                this._api.finishGame(message.result);
                break;

            case 'getLeaderboard':
                const leaderboard = await this._api.getLeaderboard(message.timeframe || 'weekly');
                this._panel.webview.postMessage({ type: 'leaderboard', data: leaderboard });
                break;

            case 'getStats':
                const localStats = this._api.getLocalStats();
                this._panel.webview.postMessage({ type: 'stats', data: localStats });
                break;

            case 'navigate':
                this.setMode(message.mode);
                break;

            case 'copyRoomCode':
                vscode.env.clipboard.writeText(message.code);
                vscode.window.showInformationMessage(`Room code ${message.code} copied!`);
                break;
        }
    }

    private _connectToRoom(roomCode: string) {
        this._api.connectToRoom(roomCode, (type, data) => {
            this._panel.webview.postMessage({ type: `room_${type}`, data });
        });
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
        :root {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d30;
            --text-primary: #d4d4d4;
            --text-secondary: #808080;
            --text-muted: #4a4a4a;
            --accent: #569cd6;
            --accent-secondary: #4ec9b0;
            --success: #4caf50;
            --warning: #ffb300;
            --error: #f44336;
            --line-number: #858585;
            --highlight-line: #2a2d2e;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
            background: var(--bg-primary);
            color: var(--text-primary);
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
            background: var(--bg-secondary);
            padding: 8px 16px;
            border-bottom: 1px solid var(--bg-tertiary);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
        }

        .file-path {
            color: var(--text-secondary);
        }

        .stats-bar {
            display: flex;
            gap: 16px;
            color: var(--text-secondary);
        }

        .stat {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .stat-value {
            color: var(--accent);
            font-weight: 600;
        }

        /* Code editor area */
        .editor-container {
            flex: 1;
            display: flex;
            overflow: hidden;
        }

        .line-numbers {
            background: var(--bg-secondary);
            padding: 16px 12px;
            text-align: right;
            color: var(--line-number);
            font-size: 14px;
            line-height: 1.6;
            user-select: none;
            min-width: 50px;
        }

        .code-area {
            flex: 1;
            padding: 16px;
            font-size: 14px;
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
            background: var(--highlight-line);
        }

        .code-line.completed {
            opacity: 0.6;
        }

        .char {
            display: inline-block;
            white-space: pre;
        }

        .char.pending {
            color: var(--text-muted);
        }

        .char.typed {
            color: var(--text-primary);
        }

        .char.correct {
            color: var(--accent-secondary);
        }

        .char.error {
            color: var(--error);
            text-decoration: underline;
        }

        .char.current {
            background: var(--accent);
            color: var(--bg-primary);
            animation: blink 1s infinite;
        }

        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        /* Hidden input for capturing keystrokes */
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
            gap: 24px;
        }

        .menu-title {
            font-size: 32px;
            color: var(--accent);
            margin-bottom: 8px;
        }

        .menu-subtitle {
            color: var(--text-secondary);
            font-size: 14px;
            margin-bottom: 24px;
        }

        .menu-buttons {
            display: flex;
            flex-direction: column;
            gap: 12px;
            width: 280px;
        }

        .menu-btn {
            background: var(--bg-tertiary);
            border: 1px solid var(--text-muted);
            color: var(--text-primary);
            padding: 14px 24px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .menu-btn:hover {
            background: var(--accent);
            color: var(--bg-primary);
            border-color: var(--accent);
        }

        .menu-btn .icon {
            font-size: 18px;
        }

        .menu-btn-primary {
            background: var(--accent);
            color: var(--bg-primary);
            border-color: var(--accent);
        }

        /* Results overlay */
        .results-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(30, 30, 30, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 24px;
            z-index: 100;
        }

        .results-card {
            background: var(--bg-secondary);
            border: 1px solid var(--bg-tertiary);
            padding: 32px 48px;
            text-align: center;
        }

        .results-wpm {
            font-size: 64px;
            color: var(--accent);
            font-weight: bold;
        }

        .results-label {
            color: var(--text-secondary);
            margin-bottom: 24px;
        }

        .results-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 24px;
            margin: 24px 0;
        }

        .result-stat {
            text-align: center;
        }

        .result-stat-value {
            font-size: 24px;
            color: var(--text-primary);
        }

        .result-stat-label {
            font-size: 12px;
            color: var(--text-secondary);
        }

        /* Multiplayer lobby */
        .lobby-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 32px;
        }

        .room-code {
            font-size: 48px;
            letter-spacing: 8px;
            color: var(--accent);
            font-weight: bold;
            margin: 16px 0;
            cursor: pointer;
        }

        .room-code:hover {
            opacity: 0.8;
        }

        .players-list {
            margin: 24px 0;
            width: 100%;
            max-width: 400px;
        }

        .player-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: var(--bg-secondary);
            margin: 4px 0;
        }

        .player-name {
            color: var(--text-primary);
        }

        .player-status {
            color: var(--text-secondary);
            font-size: 12px;
        }

        .player-host {
            color: var(--warning);
        }

        /* Multiplayer progress bars */
        .progress-container {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: var(--bg-secondary);
            padding: 12px 16px;
            border-top: 1px solid var(--bg-tertiary);
        }

        .progress-player {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 4px 0;
        }

        .progress-name {
            width: 120px;
            font-size: 12px;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .progress-bar {
            flex: 1;
            height: 8px;
            background: var(--bg-tertiary);
            border-radius: 4px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--accent);
            transition: width 0.1s;
        }

        .progress-wpm {
            width: 60px;
            text-align: right;
            font-size: 12px;
            color: var(--accent);
        }

        /* Leaderboard */
        .leaderboard-container {
            padding: 24px;
            max-width: 600px;
            margin: 0 auto;
        }

        .leaderboard-tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
        }

        .leaderboard-tab {
            padding: 8px 16px;
            background: var(--bg-tertiary);
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-family: inherit;
        }

        .leaderboard-tab.active {
            background: var(--accent);
            color: var(--bg-primary);
        }

        .leaderboard-entry {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            background: var(--bg-secondary);
            margin: 4px 0;
        }

        .leaderboard-rank {
            width: 40px;
            font-size: 18px;
            font-weight: bold;
            color: var(--warning);
        }

        .leaderboard-rank.top1 { color: #ffd700; }
        .leaderboard-rank.top2 { color: #c0c0c0; }
        .leaderboard-rank.top3 { color: #cd7f32; }

        .leaderboard-name {
            flex: 1;
            color: var(--text-primary);
        }

        .leaderboard-wpm {
            font-size: 18px;
            color: var(--accent);
            font-weight: bold;
        }

        /* Countdown overlay */
        .countdown-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(30, 30, 30, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
        }

        .countdown-number {
            font-size: 120px;
            color: var(--accent);
            font-weight: bold;
            animation: pulse 1s ease-out;
        }

        @keyframes pulse {
            0% { transform: scale(0.5); opacity: 0; }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
        }

        /* Back button */
        .back-btn {
            position: absolute;
            top: 16px;
            left: 16px;
            background: transparent;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 4px;
            font-family: inherit;
        }

        .back-btn:hover {
            color: var(--text-primary);
        }
    `;
    }

    private _getInitialContent() {
        return `<div class="loading">Loading...</div>`;
    }

    private _getScript(username: string) {
        return `
        const vscode = acquireVsCodeApi();
        const state = {
            mode: '${this._currentMode}',
            roomCode: '${this._roomCode}',
            username: '${username}',
            code: '',
            currentPos: 0,
            startTime: null,
            errors: 0,
            players: [],
            isHost: false,
            gameStarted: false
        };

        // Initialize based on mode
        function init() {
            switch(state.mode) {
                case 'menu':
                    renderMenu();
                    break;
                case 'solo':
                    vscode.postMessage({ type: 'startSolo' });
                    renderLoading('Preparing code...');
                    break;
                case 'create-room':
                    vscode.postMessage({ type: 'createRoom' });
                    renderLoading('Creating room...');
                    break;
                case 'join-room':
                    vscode.postMessage({ type: 'joinRoom', roomCode: state.roomCode });
                    renderLoading('Joining room...');
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
            app.innerHTML = \`
                <div class="menu-container">
                    <div class="menu-title">// CodeType</div>
                    <div class="menu-subtitle">Speed typing for developers. Look busy, get better.</div>
                    <div class="menu-buttons">
                        <button class="menu-btn menu-btn-primary" onclick="startSolo()">
                            <span class="icon">></span>
                            <span>Quick Solo Game</span>
                        </button>
                        <button class="menu-btn" onclick="createRoom()">
                            <span class="icon">+</span>
                            <span>Create Multiplayer Room</span>
                        </button>
                        <button class="menu-btn" onclick="promptJoinRoom()">
                            <span class="icon">#</span>
                            <span>Join Room</span>
                        </button>
                        <button class="menu-btn" onclick="showLeaderboard()">
                            <span class="icon">*</span>
                            <span>Leaderboard</span>
                        </button>
                        <button class="menu-btn" onclick="showStats()">
                            <span class="icon">@</span>
                            <span>My Stats</span>
                        </button>
                    </div>
                    <div style="margin-top: 32px; color: var(--text-muted); font-size: 12px;">
                        Playing as: <span style="color: var(--accent);">\${state.username}</span>
                    </div>
                </div>
            \`;
        }

        function renderLoading(message) {
            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="menu-container">
                    <div style="color: var(--text-secondary);">\${message}</div>
                </div>
            \`;
        }

        function renderEditor(code, showProgressBar = false) {
            state.code = code;
            state.currentPos = 0;
            state.errors = 0;
            state.startTime = null;

            const lines = code.split('\\n');
            const app = document.getElementById('app');

            app.innerHTML = \`
                <div class="editor-header">
                    <span class="file-path">src/utils.ts</span>
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
                \${showProgressBar ? '<div class="progress-container" id="progressContainer"></div>' : ''}
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
                    // Escape HTML
                    const displayChar = char === ' ' ? '&nbsp;' :
                                        char === '<' ? '&lt;' :
                                        char === '>' ? '&gt;' :
                                        char === '&' ? '&amp;' :
                                        char === '\\n' ? '&#8629;' : char;
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

                // Start timer on first keypress
                if (!state.startTime) {
                    state.startTime = Date.now();
                }

                const expectedChar = state.code[state.currentPos];

                // Handle special keys
                if (e.key === 'Tab') {
                    e.preventDefault();
                    // Check if we need spaces (tab = 4 spaces usually)
                    if (expectedChar === ' ') {
                        handleChar(' ');
                    }
                    return;
                }

                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (expectedChar === '\\n') {
                        handleChar('\\n');
                    }
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

                // Regular character
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

                // Update visual
                const charEl = document.querySelector(\`[data-idx="\${state.currentPos - 1}"]\`);
                if (charEl) {
                    charEl.className = 'char correct';
                }

                // Mark next as current
                const nextEl = document.querySelector(\`[data-idx="\${state.currentPos}"]\`);
                if (nextEl) {
                    nextEl.className = 'char current';
                }
            } else {
                state.errors++;
                // Flash error
                const charEl = document.querySelector(\`[data-idx="\${state.currentPos}"]\`);
                if (charEl) {
                    charEl.className = 'char error';
                    setTimeout(() => {
                        charEl.className = 'char current';
                    }, 150);
                }
            }

            updateStats();

            // Check if finished
            if (state.currentPos >= state.code.length) {
                finishGame();
            }

            // Update multiplayer progress
            if (state.mode === 'multiplayer-playing') {
                const progress = (state.currentPos / state.code.length) * 100;
                const wpm = calculateWPM();
                vscode.postMessage({ type: 'updateProgress', progress, wpm });
            }
        }

        function calculateWPM() {
            if (!state.startTime) return 0;
            const minutes = (Date.now() - state.startTime) / 60000;
            const words = state.currentPos / 5; // Standard: 5 chars = 1 word
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
            const endTime = Date.now();
            const result = {
                wpm: calculateWPM(),
                accuracy: Math.round((state.currentPos / (state.currentPos + state.errors)) * 100),
                time: (endTime - state.startTime) / 1000,
                characters: state.code.length,
                errors: state.errors
            };

            if (state.mode === 'multiplayer-playing') {
                vscode.postMessage({ type: 'multiplayerFinished', result });
            } else {
                vscode.postMessage({ type: 'gameFinished', result });
            }
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
                        <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--bg-tertiary);">
                            <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 8px;">Your Stats</div>
                            <div style="display: flex; gap: 24px; justify-content: center;">
                                <div style="text-align: center;">
                                    <div style="color: var(--accent);">\${stats.avgWpm}</div>
                                    <div style="color: var(--text-muted); font-size: 11px;">Avg WPM</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="color: var(--accent);">\${stats.bestWpm}</div>
                                    <div style="color: var(--text-muted); font-size: 11px;">Best WPM</div>
                                </div>
                                <div style="text-align: center;">
                                    <div style="color: var(--accent);">\${stats.gamesPlayed}</div>
                                    <div style="color: var(--text-muted); font-size: 11px;">Games</div>
                                </div>
                            </div>
                        </div>
                        <div class="menu-buttons" style="margin-top: 24px; width: auto;">
                            <button class="menu-btn menu-btn-primary" onclick="startSolo()">Play Again</button>
                            <button class="menu-btn" onclick="goToMenu()">Menu</button>
                        </div>
                    </div>
                </div>
            \`;
        }

        function renderLobby(roomCode, players, isHost) {
            state.roomCode = roomCode;
            state.players = players;
            state.isHost = isHost;

            const app = document.getElementById('app');
            app.innerHTML = \`
                <button class="back-btn" onclick="goToMenu()">< Back</button>
                <div class="lobby-container">
                    <div style="color: var(--text-secondary);">Room Code</div>
                    <div class="room-code" onclick="copyRoomCode()" title="Click to copy">\${roomCode}</div>
                    <div style="color: var(--text-muted); font-size: 12px;">Click to copy - Share with friends!</div>

                    <div class="players-list">
                        <div style="color: var(--text-secondary); margin-bottom: 8px;">Players (\${players.length})</div>
                        \${players.map(p => \`
                            <div class="player-item">
                                <span class="player-name">\${p.username} \${p.isHost ? '<span class="player-host">(Host)</span>' : ''}</span>
                                <span class="player-status">\${p.ready ? 'Ready' : 'Waiting'}</span>
                            </div>
                        \`).join('')}
                    </div>

                    \${isHost ? \`
                        <button class="menu-btn menu-btn-primary" onclick="startMultiplayer()" \${players.length < 1 ? 'disabled' : ''}>
                            Start Game
                        </button>
                    \` : \`
                        <div style="color: var(--text-secondary);">Waiting for host to start...</div>
                    \`}
                </div>
            \`;
        }

        function renderMultiplayerProgress(players) {
            const container = document.getElementById('progressContainer');
            if (!container) return;

            container.innerHTML = players.map(p => \`
                <div class="progress-player">
                    <span class="progress-name">\${p.username}</span>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: \${p.progress}%"></div>
                    </div>
                    <span class="progress-wpm">\${p.wpm} WPM</span>
                </div>
            \`).join('');
        }

        function renderLeaderboard(data, timeframe = 'weekly') {
            const app = document.getElementById('app');
            app.innerHTML = \`
                <button class="back-btn" onclick="goToMenu()">< Back</button>
                <div class="leaderboard-container">
                    <h2 style="color: var(--accent); margin-bottom: 16px;">Leaderboard</h2>
                    <div class="leaderboard-tabs">
                        <button class="leaderboard-tab \${timeframe === 'daily' ? 'active' : ''}"
                            onclick="loadLeaderboard('daily')">Daily</button>
                        <button class="leaderboard-tab \${timeframe === 'weekly' ? 'active' : ''}"
                            onclick="loadLeaderboard('weekly')">Weekly</button>
                        <button class="leaderboard-tab \${timeframe === 'alltime' ? 'active' : ''}"
                            onclick="loadLeaderboard('alltime')">All Time</button>
                    </div>
                    \${data.length === 0 ? \`
                        <div style="text-align: center; color: var(--text-secondary); padding: 48px;">
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

        function renderStats(data) {
            const avgWpm = data.gamesPlayed > 0 ? Math.round(data.totalWpm / data.gamesPlayed) : 0;
            const app = document.getElementById('app');
            app.innerHTML = \`
                <button class="back-btn" onclick="goToMenu()">< Back</button>
                <div class="leaderboard-container">
                    <h2 style="color: var(--accent); margin-bottom: 24px;">My Stats</h2>
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px;">
                        <div style="background: var(--bg-secondary); padding: 24px; text-align: center;">
                            <div style="font-size: 36px; color: var(--accent);">\${data.gamesPlayed}</div>
                            <div style="color: var(--text-secondary); font-size: 12px;">Games Played</div>
                        </div>
                        <div style="background: var(--bg-secondary); padding: 24px; text-align: center;">
                            <div style="font-size: 36px; color: var(--accent);">\${avgWpm}</div>
                            <div style="color: var(--text-secondary); font-size: 12px;">Average WPM</div>
                        </div>
                        <div style="background: var(--bg-secondary); padding: 24px; text-align: center;">
                            <div style="font-size: 36px; color: var(--accent);">\${data.bestWpm}</div>
                            <div style="color: var(--text-secondary); font-size: 12px;">Best WPM</div>
                        </div>
                    </div>
                    <h3 style="color: var(--text-secondary); margin-bottom: 16px;">Recent Games</h3>
                    \${data.games.slice(-10).reverse().map(g => \`
                        <div class="leaderboard-entry">
                            <span style="color: var(--text-secondary); font-size: 12px; width: 100px;">
                                \${new Date(g.timestamp).toLocaleDateString()}
                            </span>
                            <span style="flex: 1;">\${g.wpm} WPM</span>
                            <span style="color: var(--text-muted);">\${g.accuracy}% accuracy</span>
                        </div>
                    \`).join('') || '<div style="color: var(--text-muted);">No games yet</div>'}
                </div>
            \`;
        }

        // Navigation functions
        function goToMenu() {
            state.mode = 'menu';
            renderMenu();
        }

        function startSolo() {
            state.mode = 'solo';
            vscode.postMessage({ type: 'startSolo' });
            renderLoading('Preparing code...');
        }

        function createRoom() {
            state.mode = 'create-room';
            vscode.postMessage({ type: 'createRoom' });
            renderLoading('Creating room...');
        }

        function promptJoinRoom() {
            const code = prompt('Enter room code:');
            if (code) {
                state.mode = 'join-room';
                state.roomCode = code.toUpperCase();
                vscode.postMessage({ type: 'joinRoom', roomCode: state.roomCode });
                renderLoading('Joining room...');
            }
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

        function copyRoomCode() {
            vscode.postMessage({ type: 'copyRoomCode', code: state.roomCode });
        }

        function startMultiplayer() {
            vscode.postMessage({ type: 'startMultiplayer' });
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'loadCode':
                    state.mode = 'playing';
                    renderEditor(message.code, false);
                    break;

                case 'showResults':
                    renderResults(message.result, message.stats);
                    break;

                case 'roomCreated':
                    state.isHost = true;
                    renderLobby(message.roomCode, [{ username: state.username, isHost: true, ready: true }], true);
                    break;

                case 'room_playerJoined':
                case 'room_playerLeft':
                case 'room_update':
                    renderLobby(state.roomCode, message.data.players, state.isHost);
                    break;

                case 'room_gameStart':
                    state.mode = 'multiplayer-playing';
                    state.code = message.data.codeSnippet;
                    renderEditor(message.data.codeSnippet, true);
                    break;

                case 'room_progress':
                    renderMultiplayerProgress(message.data.players);
                    break;

                case 'room_gameEnd':
                    renderResults(message.data.yourResult, message.data.stats);
                    break;

                case 'leaderboard':
                    renderLeaderboard(message.data, 'weekly');
                    break;

                case 'stats':
                    renderStats(message.data);
                    break;

                case 'error':
                    alert(message.message);
                    goToMenu();
                    break;
            }
        });

        // Initialize
        init();
        `;
    }

    public dispose() {
        CodeTypePanel.currentPanel = undefined;
        this._api.disconnectRoom();
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}
