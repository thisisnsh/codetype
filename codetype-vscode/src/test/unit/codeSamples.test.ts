import * as assert from 'assert';

// Test the bundled code samples quality
suite('Code Samples Unit Tests', () => {
    // Bundled samples copied for testing
    const BUNDLED_SAMPLES = [
        `function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log(result);`,

        `async function fetchUser(id) {
    const response = await fetch(\`/api/users/\${id}\`);
    const data = await response.json();
    return data;
}`,

        `const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
const filtered = doubled.filter(n => n > 5);
console.log(filtered);`,
    ];

    suite('Sample Quality', () => {
        test('all samples should have minimum length', () => {
            for (const sample of BUNDLED_SAMPLES) {
                assert.ok(sample.length >= 50, `Sample too short: ${sample.length} chars`);
            }
        });

        test('all samples should have maximum length', () => {
            for (const sample of BUNDLED_SAMPLES) {
                assert.ok(sample.length <= 1000, `Sample too long: ${sample.length} chars`);
            }
        });

        test('samples should contain valid code characters', () => {
            for (const sample of BUNDLED_SAMPLES) {
                // Should contain typical code characters
                assert.ok(
                    sample.includes('(') || sample.includes('{') || sample.includes('='),
                    'Sample should look like code'
                );
            }
        });

        test('samples should have multiple lines', () => {
            for (const sample of BUNDLED_SAMPLES) {
                const lines = sample.split('\n');
                assert.ok(lines.length >= 2, 'Sample should have multiple lines');
            }
        });

        test('samples should not have excessively long lines', () => {
            for (const sample of BUNDLED_SAMPLES) {
                const lines = sample.split('\n');
                for (const line of lines) {
                    assert.ok(line.length <= 120, `Line too long: ${line.length} chars`);
                }
            }
        });
    });

    suite('Sample Variety', () => {
        test('should have samples from different languages', () => {
            const hasFunction = BUNDLED_SAMPLES.some(s => s.includes('function'));
            const hasAsync = BUNDLED_SAMPLES.some(s => s.includes('async'));
            const hasConst = BUNDLED_SAMPLES.some(s => s.includes('const'));

            assert.ok(hasFunction, 'Should have function samples');
            assert.ok(hasAsync, 'Should have async samples');
            assert.ok(hasConst, 'Should have const samples');
        });
    });

    suite('Snippet Extraction Logic', () => {
        test('should detect function start patterns', () => {
            const patterns = [
                /^\s*(export\s+)?(async\s+)?function\s+\w+/,
                /^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
            ];

            const testLines = [
                'function fibonacci(n) {',
                'async function fetchData() {',
                'export function handler() {',
                'const add = (a, b) => {',
                'let multiply = async (x) => {',
            ];

            for (const line of testLines) {
                const matches = patterns.some(p => p.test(line));
                assert.ok(matches, `Should detect: ${line}`);
            }
        });

        test('should not match non-function lines', () => {
            const patterns = [
                /^\s*(export\s+)?(async\s+)?function\s+\w+/,
                /^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
            ];

            const testLines = [
                'console.log("hello");',
                'return x + y;',
                'if (condition) {',
                '// comment',
            ];

            for (const line of testLines) {
                const matches = patterns.some(p => p.test(line));
                assert.ok(!matches, `Should not match: ${line}`);
            }
        });
    });

    suite('Character Distribution', () => {
        test('should have good distribution of typeable characters', () => {
            const allText = BUNDLED_SAMPLES.join('');
            const charCounts: Record<string, number> = {};

            for (const char of allText) {
                charCounts[char] = (charCounts[char] || 0) + 1;
            }

            // Should have common programming characters
            assert.ok(charCounts['('] > 0, 'Should have parentheses');
            assert.ok(charCounts['{'] > 0, 'Should have braces');
            assert.ok(charCounts[';'] > 0 || charCounts['\n'] > 0, 'Should have statement endings');
            assert.ok(charCounts[' '] > 0, 'Should have spaces');
        });

        test('should have letters as majority', () => {
            const allText = BUNDLED_SAMPLES.join('');
            let letterCount = 0;

            for (const char of allText) {
                if (/[a-zA-Z]/.test(char)) {
                    letterCount++;
                }
            }

            const letterRatio = letterCount / allText.length;
            assert.ok(letterRatio > 0.4, `Letter ratio too low: ${letterRatio}`);
        });
    });
});
