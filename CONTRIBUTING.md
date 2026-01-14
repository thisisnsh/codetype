# Contributing to CodeType

First off, thanks for taking the time to contribute!

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [VS Code](https://code.visualstudio.com/) (v1.85.0 or higher)
- [Git](https://git-scm.com/)

### Types of Contributions

We welcome:

- Bug fixes
- New features
- Documentation improvements
- Code samples for the typing game
- UI/UX improvements
- Performance optimizations
- Test coverage improvements

## Development Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/yourusername/codetype.git
   cd codetype
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Compile the extension**

   ```bash
   npm run compile
   ```

4. **Open in VS Code**

   ```bash
   code .
   ```

5. **Launch the extension**

   Press `F5` to open a new VS Code window with the extension loaded.

### Worker Development (Optional)

If you're working on multiplayer features:

```bash
cd worker
npm install
npm run dev  # Starts local development server
```

## Making Changes

### Branching Strategy

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates

### Creating a Branch

```bash
git checkout -b feature/your-feature-name
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

Examples:
```
feat(game): add countdown timer before game start
fix(wpm): correct calculation for short code snippets
docs(readme): add multiplayer setup instructions
```

## Testing

### Running Tests

```bash
# Run all tests (integration + unit)
npm test

# Run unit tests only
npm run test:unit

# Run with watch mode during development
npm run watch
```

### Writing Tests

- **Unit tests**: `src/test/unit/` - Test pure functions and logic
- **Integration tests**: `src/test/suite/` - Test VS Code integration

Example unit test:

```typescript
import * as assert from 'assert';
import { calculateWPM } from '../../utils/gameLogic';

suite('WPM Calculation', () => {
    test('should calculate correct WPM', () => {
        // 250 chars in 60 seconds = 50 WPM
        assert.strictEqual(calculateWPM(250, 60000), 50);
    });
});
```

### Test Coverage Goals

- Core game logic: 90%+
- API client: 80%+
- Extension commands: 70%+

## Pull Request Process

1. **Update documentation** if you've changed functionality
2. **Add tests** for new features
3. **Ensure all tests pass** (`npm test`)
4. **Lint your code** (`npm run lint`)
5. **Update the CHANGELOG.md** with your changes

### PR Template

When opening a PR, include:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code follows style guide
- [ ] Self-reviewed my code
- [ ] Commented hard-to-understand areas
- [ ] Documentation updated
- [ ] No new warnings
```

### Review Process

1. At least one maintainer must approve
2. All CI checks must pass
3. No merge conflicts
4. Squash commits on merge

## Style Guide

### TypeScript

- Use strict TypeScript
- Prefer `const` over `let`
- Use explicit return types for functions
- Document public APIs with JSDoc

```typescript
/**
 * Calculate words per minute
 * @param chars - Number of characters typed
 * @param timeMs - Time elapsed in milliseconds
 * @returns WPM rounded to nearest integer
 */
export function calculateWPM(chars: number, timeMs: number): number {
    // ...
}
```

### CSS (WebView)

- Use CSS variables for theming
- Mobile-first responsive design
- BEM naming convention

```css
.game-container { }
.game-container__header { }
.game-container__header--active { }
```

### File Organization

```
src/
├── extension.ts       # Entry point only
├── api.ts             # API client
├── codeSamples.ts     # Sample provider
├── utils/             # Pure utility functions
├── webview/           # WebView components
└── test/              # Tests mirror src structure
```

## Adding Code Samples

To add new typing samples:

1. Edit `src/codeSamples.ts`
2. Add to `BUNDLED_SAMPLES` array
3. Ensure sample is:
   - 50-800 characters
   - Real, syntactically correct code
   - Interesting to type (varied characters)
   - From a popular language

```typescript
const BUNDLED_SAMPLES = [
    // Your new sample
    `function newSample() {
        return "Hello, CodeType!";
    }`,
    // ...
];
```

## Questions?

- Open an [issue](https://github.com/yourusername/codetype/issues) for bugs
- Start a [discussion](https://github.com/yourusername/codetype/discussions) for questions
- Check existing issues before creating new ones

Thank you for contributing!
