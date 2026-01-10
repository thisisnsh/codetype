# CodeType

<p align="center">
  <strong>Speed typing competition disguised as normal coding.</strong><br>
  Play solo or with friends while looking productive.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#multiplayer">Multiplayer</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Why CodeType?

**Perfect for vibe coding sessions.** When you're waiting for AI to generate code, or sitting through a long build, look busy while actually improving your typing speed. The game opens as a file called `utils.ts` - your colleagues will never know.

## Features

- **Stealth Mode**: Opens as a regular editor tab named "utils.ts"
- **Real Code**: Type actual code snippets from your workspace or curated samples
- **Solo Mode**: Practice typing with instant WPM tracking (works offline!)
- **Multiplayer**: Create rooms and compete with friends via invite codes
- **Leaderboards**: Daily, weekly, and all-time rankings
- **Stats Tracking**: Personal best, average WPM, games played
- **Keyboard Shortcut**: Quick launch with `Cmd+Shift+T` / `Ctrl+Shift+T`

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "CodeType"
4. Click Install

### From Source

```bash
git clone https://github.com/yourusername/codetype.git
cd codetype
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host.

## Usage

### Quick Start

1. Press `Cmd+Shift+T` (Mac) or `Ctrl+Shift+T` (Windows/Linux)
2. Select "Quick Solo Game"
3. Start typing the grey code - it lights up as you type correctly!

### Commands

| Command | Description | Shortcut |
|---------|-------------|----------|
| `CodeType: Start Typing Practice` | Open main menu | `Cmd/Ctrl+Shift+T` |
| `CodeType: Quick Solo Game` | Start solo game | - |
| `CodeType: Create Multiplayer Room` | Host a game | - |
| `CodeType: Join Multiplayer Room` | Join with code | - |
| `CodeType: View Leaderboard` | See rankings | - |
| `CodeType: View My Stats` | Personal stats | - |
| `CodeType: Set Username` | Change name | - |

### How It Works

1. **Grey Text**: Untyped code appears in muted grey (like comments)
2. **Live Highlighting**: Correct characters light up in your theme colors
3. **Line Numbers**: Authentic VS Code editor styling
4. **Stats Bar**: WPM, accuracy, and progress shown subtly at the top
5. **Stealth Title**: Tab shows "utils.ts" instead of "CodeType"

## Multiplayer

### Setting Up the Backend

Multiplayer requires deploying the Cloudflare Worker:

```bash
cd worker
npm install

# Create KV namespace
wrangler kv:namespace create CODETYPE_KV
# Copy the ID to wrangler.toml

# Deploy
npm run deploy
```

Then update `src/api.ts` with your Worker URL.

### Playing with Friends

1. **Host**: Run `CodeType: Create Multiplayer Room`
2. **Share**: Click the 6-character room code to copy it
3. **Friends**: Run `CodeType: Join Multiplayer Room` and enter the code
4. **Race**: Host clicks "Start Game" and everyone types the same code!

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `codetype.username` | `""` | Display name for leaderboards |
| `codetype.theme` | `"stealth"` | UI theme: stealth, minimal, hacker |
| `codetype.soundEnabled` | `false` | Typing sounds (risky in office!) |
| `codetype.useWorkspaceCode` | `true` | Use code from your workspace |

## Development

### Project Structure

```
codetype/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── api.ts                 # Backend API client
│   ├── codeSamples.ts         # Code snippet provider
│   ├── utils/
│   │   └── gameLogic.ts       # Core game logic
│   ├── webview/
│   │   └── CodeTypePanel.ts   # Game UI
│   └── test/
│       ├── suite/             # Integration tests
│       └── unit/              # Unit tests
├── worker/
│   └── src/index.ts           # Cloudflare Worker
└── package.json
```

### Running Tests

```bash
# All tests (requires VS Code)
npm test

# Unit tests only
npm run test:unit

# Watch mode
npm run watch
```

### Building

```bash
# Compile TypeScript
npm run compile

# Package extension
vsce package
```

## Scoring

- **WPM (Words Per Minute)**: Characters typed ÷ 5 ÷ minutes elapsed
- **Accuracy**: Correct keystrokes ÷ total keystrokes × 100

### Rank Titles

| WPM | Rank |
|-----|------|
| 150+ | Legendary |
| 120-149 | Master |
| 100-119 | Expert |
| 80-99 | Advanced |
| 60-79 | Intermediate |
| 40-59 | Beginner |
| 0-39 | Novice |

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Inspired by [MonkeyType](https://monkeytype.com/) and [TypeRacer](https://play.typeracer.com/)
- Built with [VS Code Extension API](https://code.visualstudio.com/api)
- Backend powered by [Cloudflare Workers](https://workers.cloudflare.com/)

---

<p align="center">
  Made with caution by developers who just want to look busy.
</p>
