# CodeType VS Code Extension

## Requirements

- Node.js 18+
- VS Code 1.85+

## Develop

```bash
cd codetype-vscode
npm install
npm run compile
```

Launch the Extension Development Host with `F5` in VS Code.

Optional watch mode:

```bash
npm run watch
```

## Test

```bash
npm test
npm run test:unit
npm run lint
```

## Release

```bash
npm run vscode:prepublish
npx vsce package
```

Publish (requires marketplace credentials):

```bash
npx vsce publish
```
