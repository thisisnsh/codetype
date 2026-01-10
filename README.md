# CodeType

<p align="center">
  <strong>Speed typing competition disguised as normal coding.</strong><br>
  Play solo or with friends while looking productive.
</p>

<p align="center">
  <a href="#why-codetype">Why CodeType?</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#project-structure">Project Structure</a> •
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
cd codetype/codetype-vscode
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host.

## Project Structure

This monorepo contains:

```
codetype/
├── codetype-vscode/      # VS Code extension
│   ├── src/              # Extension source code
│   ├── worker/           # Cloudflare Worker backend
│   └── package.json
├── codetype-website/     # Promotional website
│   ├── src/              # Eleventy source files
│   └── package.json
├── README.md             # This file
├── LICENSE               # MIT License
├── CONTRIBUTING.md       # Contribution guidelines
├── CODE_OF_CONDUCT.md    # Community guidelines
└── SECURITY.md           # Security policy
```

### VS Code Extension

The main extension lives in `codetype-vscode/`. See [codetype-vscode/CHANGELOG.md](codetype-vscode/CHANGELOG.md) for version history.

### Website

The promotional website is in `codetype-website/`. Built with Eleventy and designed to look like VS Code.

To run locally:
```bash
cd codetype-website
npm install
npm start
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
- Website built with [Eleventy](https://www.11ty.dev/)

---

<p align="center">
  Made with caution by developers who just want to look busy.
</p>
