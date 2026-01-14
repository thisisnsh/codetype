# Changelog

All notable changes to CodeType will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release preparation

## [1.0.0] - 2024-XX-XX

### Added
- **Solo Mode**: Play a typing game with real code snippets
  - WPM (words per minute) calculation
  - Accuracy tracking
  - Progress indicator
  - Local stats storage

- **Multiplayer Mode**: Compete with friends
  - Create rooms with 6-character invite codes
  - Real-time progress tracking
  - WebSocket-based synchronization
  - Race against friends with live position updates

- **Stealth UI**: Looks like normal coding
  - Opens as a normal file tab (solo.ts, stats.ts, team.ts)
  - Grey pending text, highlighted typed text
  - Authentic VS Code editor styling
  - Line numbers and code formatting

- **Code Samples**: Real code to type
  - Workspace code extraction
  - Bundled samples from multiple languages
  - JavaScript, TypeScript, Python, Rust, Go, and more

- **Leaderboards**: Track your progress
  - Daily, weekly, and all-time rankings
  - Personal best tracking
  - Games played counter
  - Average WPM calculation

- **Configuration Options**
  - Custom username
  - Theme selection (stealth, minimal, hacker)
  - Sound toggle
  - Workspace code preference

- **Keyboard Shortcut**: `Cmd+Shift+T` / `Ctrl+Shift+T`

### Backend
- Cloudflare Worker for multiplayer
- Durable Objects for real-time rooms
- KV storage for leaderboards

### Developer Experience
- Full TypeScript codebase
- Unit and integration tests
- ESLint configuration
- VS Code launch configuration

## Future Plans

### [1.1.0] - Planned
- Custom code snippets
- Team/organization leaderboards
- Typing accuracy modes (strict vs. forgiving)
- Sound effects pack

### [1.2.0] - Planned
- Tournament mode
- Daily challenges
- Achievement system
- Profile badges

---

[Unreleased]: https://github.com/yourusername/codetype/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/codetype/releases/tag/v1.0.0
