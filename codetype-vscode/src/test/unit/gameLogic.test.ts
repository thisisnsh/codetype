import * as assert from 'assert';
import {
    calculateWPM,
    calculateAccuracy,
    calculateProgress,
    validateCharacter,
    createGameState,
    processCharacter,
    processBackspace,
    isGameComplete,
    formatTime,
    generateRoomCode,
    isValidRoomCode,
    isValidUsername,
    getRankTitle,
    getRankColor
} from '../../utils/gameLogic';

suite('Game Logic Unit Tests', () => {
    suite('calculateWPM', () => {
        test('should return 0 for 0 characters', () => {
            assert.strictEqual(calculateWPM(0, 60000), 0);
        });

        test('should return 0 for 0 time', () => {
            assert.strictEqual(calculateWPM(100, 0), 0);
        });

        test('should calculate correct WPM for 1 minute', () => {
            // 250 characters in 1 minute = 50 words (5 chars per word) = 50 WPM
            assert.strictEqual(calculateWPM(250, 60000), 50);
        });

        test('should calculate correct WPM for 30 seconds', () => {
            // 125 characters in 30 seconds = 25 words = 50 WPM
            assert.strictEqual(calculateWPM(125, 30000), 50);
        });

        test('should round WPM to nearest integer', () => {
            // 127 characters in 30 seconds = 25.4 words = 50.8 WPM -> 51
            assert.strictEqual(calculateWPM(127, 30000), 51);
        });

        test('should handle high speed typing', () => {
            // 500 characters in 1 minute = 100 WPM
            assert.strictEqual(calculateWPM(500, 60000), 100);
        });
    });

    suite('calculateAccuracy', () => {
        test('should return 100 for no attempts', () => {
            assert.strictEqual(calculateAccuracy(0, 0), 100);
        });

        test('should return 100 for perfect accuracy', () => {
            assert.strictEqual(calculateAccuracy(100, 100), 100);
        });

        test('should calculate correct percentage', () => {
            assert.strictEqual(calculateAccuracy(90, 100), 90);
        });

        test('should round to nearest integer', () => {
            assert.strictEqual(calculateAccuracy(91, 100), 91);
        });

        test('should handle 50% accuracy', () => {
            assert.strictEqual(calculateAccuracy(50, 100), 50);
        });
    });

    suite('calculateProgress', () => {
        test('should return 0 for empty code', () => {
            assert.strictEqual(calculateProgress(0, 0), 0);
        });

        test('should return 0 at start', () => {
            assert.strictEqual(calculateProgress(0, 100), 0);
        });

        test('should return 100 at end', () => {
            assert.strictEqual(calculateProgress(100, 100), 100);
        });

        test('should calculate correct percentage', () => {
            assert.strictEqual(calculateProgress(50, 100), 50);
        });

        test('should round to nearest integer', () => {
            assert.strictEqual(calculateProgress(33, 100), 33);
        });
    });

    suite('validateCharacter', () => {
        test('should return true for matching characters', () => {
            assert.strictEqual(validateCharacter('a', 'a'), true);
        });

        test('should return false for non-matching characters', () => {
            assert.strictEqual(validateCharacter('a', 'b'), false);
        });

        test('should be case sensitive', () => {
            assert.strictEqual(validateCharacter('A', 'a'), false);
        });

        test('should handle special characters', () => {
            assert.strictEqual(validateCharacter('\n', '\n'), true);
            assert.strictEqual(validateCharacter('\t', '\t'), true);
            assert.strictEqual(validateCharacter(' ', ' '), true);
        });

        test('should handle symbols', () => {
            assert.strictEqual(validateCharacter('{', '{'), true);
            assert.strictEqual(validateCharacter('(', ')'), false);
        });
    });

    suite('createGameState', () => {
        test('should create initial state with code', () => {
            const state = createGameState('const x = 1;');
            assert.strictEqual(state.code, 'const x = 1;');
            assert.strictEqual(state.currentPos, 0);
            assert.strictEqual(state.startTime, null);
            assert.strictEqual(state.errors, 0);
        });

        test('should handle empty code', () => {
            const state = createGameState('');
            assert.strictEqual(state.code, '');
            assert.strictEqual(state.currentPos, 0);
        });
    });

    suite('processCharacter', () => {
        test('should advance position on correct input', () => {
            const state = createGameState('abc');
            const result = processCharacter(state, 'a');
            assert.strictEqual(result.correct, true);
            assert.strictEqual(result.state.currentPos, 1);
            assert.strictEqual(result.state.errors, 0);
        });

        test('should not advance on incorrect input', () => {
            const state = createGameState('abc');
            const result = processCharacter(state, 'x');
            assert.strictEqual(result.correct, false);
            assert.strictEqual(result.state.currentPos, 0);
            assert.strictEqual(result.state.errors, 1);
        });

        test('should start timer on first input', () => {
            const state = createGameState('abc');
            const result = processCharacter(state, 'a');
            assert.notStrictEqual(result.state.startTime, null);
        });

        test('should accumulate errors', () => {
            let state = createGameState('abc');
            let result = processCharacter(state, 'x');
            result = processCharacter(result.state, 'y');
            assert.strictEqual(result.state.errors, 2);
        });
    });

    suite('processBackspace', () => {
        test('should go back one position', () => {
            const state = { ...createGameState('abc'), currentPos: 2 };
            const newState = processBackspace(state);
            assert.strictEqual(newState.currentPos, 1);
        });

        test('should not go below 0', () => {
            const state = createGameState('abc');
            const newState = processBackspace(state);
            assert.strictEqual(newState.currentPos, 0);
        });

        test('should preserve other state', () => {
            const state = { ...createGameState('abc'), currentPos: 2, errors: 3 };
            const newState = processBackspace(state);
            assert.strictEqual(newState.errors, 3);
            assert.strictEqual(newState.code, 'abc');
        });
    });

    suite('isGameComplete', () => {
        test('should return false at start', () => {
            const state = createGameState('abc');
            assert.strictEqual(isGameComplete(state), false);
        });

        test('should return false in progress', () => {
            const state = { ...createGameState('abc'), currentPos: 1 };
            assert.strictEqual(isGameComplete(state), false);
        });

        test('should return true at end', () => {
            const state = { ...createGameState('abc'), currentPos: 3 };
            assert.strictEqual(isGameComplete(state), true);
        });

        test('should handle empty code', () => {
            const state = createGameState('');
            assert.strictEqual(isGameComplete(state), true);
        });
    });

    suite('formatTime', () => {
        test('should format seconds only', () => {
            assert.strictEqual(formatTime(30), '30.0s');
        });

        test('should format with decimal', () => {
            assert.strictEqual(formatTime(30.5), '30.5s');
        });

        test('should format minutes and seconds', () => {
            assert.strictEqual(formatTime(90), '1m 30s');
        });

        test('should format multiple minutes', () => {
            assert.strictEqual(formatTime(125), '2m 5s');
        });
    });

    suite('generateRoomCode', () => {
        test('should generate 6 character code', () => {
            const code = generateRoomCode();
            assert.strictEqual(code.length, 6);
        });

        test('should only use valid characters', () => {
            const code = generateRoomCode();
            const validChars = /^[A-Z0-9]+$/;
            assert.ok(validChars.test(code));
        });

        test('should generate different codes', () => {
            const codes = new Set<string>();
            for (let i = 0; i < 100; i++) {
                codes.add(generateRoomCode());
            }
            // Should have mostly unique codes (allowing for some collisions)
            assert.ok(codes.size > 90);
        });

        test('should not contain confusing characters', () => {
            // Generate many codes and check for O, 0, I, 1, L confusion
            for (let i = 0; i < 100; i++) {
                const code = generateRoomCode();
                assert.ok(!code.includes('O'), 'Should not contain O');
                assert.ok(!code.includes('I'), 'Should not contain I');
                assert.ok(!code.includes('L'), 'Should not contain L');
                assert.ok(!code.includes('1'), 'Should not contain 1');
                assert.ok(!code.includes('0'), 'Should not contain 0');
            }
        });
    });

    suite('isValidRoomCode', () => {
        test('should accept valid 6 character code', () => {
            assert.strictEqual(isValidRoomCode('ABC123'), true);
        });

        test('should reject empty code', () => {
            assert.strictEqual(isValidRoomCode(''), false);
        });

        test('should reject short code', () => {
            assert.strictEqual(isValidRoomCode('ABC'), false);
        });

        test('should reject long code', () => {
            assert.strictEqual(isValidRoomCode('ABC12345'), false);
        });

        test('should accept lowercase (converted)', () => {
            assert.strictEqual(isValidRoomCode('abc123'), true);
        });
    });

    suite('isValidUsername', () => {
        test('should accept valid username', () => {
            const result = isValidUsername('speedcoder42');
            assert.strictEqual(result.valid, true);
        });

        test('should reject empty username', () => {
            const result = isValidUsername('');
            assert.strictEqual(result.valid, false);
            assert.ok(result.error);
        });

        test('should reject short username', () => {
            const result = isValidUsername('a');
            assert.strictEqual(result.valid, false);
        });

        test('should reject long username', () => {
            const result = isValidUsername('a'.repeat(25));
            assert.strictEqual(result.valid, false);
        });

        test('should accept underscores and hyphens', () => {
            assert.strictEqual(isValidUsername('speed_coder-42').valid, true);
        });

        test('should reject special characters', () => {
            assert.strictEqual(isValidUsername('speed@coder').valid, false);
            assert.strictEqual(isValidUsername('speed coder').valid, false);
            assert.strictEqual(isValidUsername('speed.coder').valid, false);
        });
    });

    suite('getRankTitle', () => {
        test('should return Novice for low WPM', () => {
            assert.strictEqual(getRankTitle(20), 'Novice');
        });

        test('should return Beginner for 40+ WPM', () => {
            assert.strictEqual(getRankTitle(45), 'Beginner');
        });

        test('should return Intermediate for 60+ WPM', () => {
            assert.strictEqual(getRankTitle(65), 'Intermediate');
        });

        test('should return Advanced for 80+ WPM', () => {
            assert.strictEqual(getRankTitle(85), 'Advanced');
        });

        test('should return Expert for 100+ WPM', () => {
            assert.strictEqual(getRankTitle(105), 'Expert');
        });

        test('should return Master for 120+ WPM', () => {
            assert.strictEqual(getRankTitle(125), 'Master');
        });

        test('should return Legendary for 150+ WPM', () => {
            assert.strictEqual(getRankTitle(155), 'Legendary');
        });
    });

    suite('getRankColor', () => {
        test('should return gray for Novice', () => {
            assert.strictEqual(getRankColor(20), '#808080');
        });

        test('should return gold for Legendary', () => {
            assert.strictEqual(getRankColor(155), '#ff6b6b');
        });
    });
});
