/**
 * Core game logic utilities for CodeType
 * Extracted for easier unit testing
 */

export interface GameState {
    code: string;
    currentPos: number;
    startTime: number | null;
    errors: number;
}

export interface GameResult {
    wpm: number;
    accuracy: number;
    time: number;
    characters: number;
    errors: number;
}

/**
 * Calculate words per minute based on characters typed and time elapsed
 * Standard: 5 characters = 1 word
 */
export function calculateWPM(charactersTyped: number, elapsedTimeMs: number): number {
    if (elapsedTimeMs <= 0 || charactersTyped <= 0) {
        return 0;
    }

    const minutes = elapsedTimeMs / 60000;
    const words = charactersTyped / 5;
    return Math.round(words / minutes);
}

/**
 * Calculate typing accuracy as a percentage
 */
export function calculateAccuracy(correctChars: number, totalAttempts: number): number {
    if (totalAttempts <= 0) {
        return 100;
    }

    return Math.round((correctChars / totalAttempts) * 100);
}

/**
 * Calculate progress as a percentage
 */
export function calculateProgress(currentPos: number, totalLength: number): number {
    if (totalLength <= 0) {
        return 0;
    }

    return Math.round((currentPos / totalLength) * 100);
}

/**
 * Validate a character input against expected character
 */
export function validateCharacter(input: string, expected: string): boolean {
    return input === expected;
}

/**
 * Create initial game state
 */
export function createGameState(code: string): GameState {
    return {
        code,
        currentPos: 0,
        startTime: null,
        errors: 0
    };
}

/**
 * Process a character input and return updated state
 */
export function processCharacter(
    state: GameState,
    inputChar: string
): { state: GameState; correct: boolean } {
    const newState = { ...state };

    // Start timer on first input
    if (newState.startTime === null) {
        newState.startTime = Date.now();
    }

    const expectedChar = state.code[state.currentPos];
    const correct = validateCharacter(inputChar, expectedChar);

    if (correct) {
        newState.currentPos++;
    } else {
        newState.errors++;
    }

    return { state: newState, correct };
}

/**
 * Handle backspace - go back one position
 */
export function processBackspace(state: GameState): GameState {
    if (state.currentPos <= 0) {
        return state;
    }

    return {
        ...state,
        currentPos: state.currentPos - 1
    };
}

/**
 * Check if game is complete
 */
export function isGameComplete(state: GameState): boolean {
    return state.currentPos >= state.code.length;
}

/**
 * Calculate final game result
 */
export function calculateGameResult(state: GameState): GameResult {
    const endTime = Date.now();
    const elapsedTimeMs = state.startTime ? endTime - state.startTime : 0;

    return {
        wpm: calculateWPM(state.currentPos, elapsedTimeMs),
        accuracy: calculateAccuracy(state.currentPos, state.currentPos + state.errors),
        time: elapsedTimeMs / 1000,
        characters: state.code.length,
        errors: state.errors
    };
}

/**
 * Format time in seconds to display string
 */
export function formatTime(seconds: number): string {
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }

    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
}

/**
 * Generate room code - 6 character alphanumeric (excluding confusing chars)
 */
export function generateRoomCode(): string {
    // Exclude confusing characters: O/0, I/1/L
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * Validate room code format
 */
export function isValidRoomCode(code: string): boolean {
    if (!code || code.length !== 6) {
        return false;
    }

    const validChars = /^[A-Z0-9]+$/;
    return validChars.test(code.toUpperCase());
}

/**
 * Validate username
 */
export function isValidUsername(username: string): { valid: boolean; error?: string } {
    if (!username || username.length < 2) {
        return { valid: false, error: 'Username must be at least 2 characters' };
    }

    if (username.length > 20) {
        return { valid: false, error: 'Username must be 20 characters or less' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return { valid: false, error: 'Only letters, numbers, underscores, and hyphens allowed' };
    }

    return { valid: true };
}

/**
 * Calculate rank title based on average WPM
 */
export function getRankTitle(avgWpm: number): string {
    if (avgWpm >= 150) return 'Legendary';
    if (avgWpm >= 120) return 'Master';
    if (avgWpm >= 100) return 'Expert';
    if (avgWpm >= 80) return 'Advanced';
    if (avgWpm >= 60) return 'Intermediate';
    if (avgWpm >= 40) return 'Beginner';
    return 'Novice';
}

/**
 * Calculate rank color for UI
 */
export function getRankColor(avgWpm: number): string {
    if (avgWpm >= 150) return '#ff6b6b';  // Red/Gold
    if (avgWpm >= 120) return '#ffd700';  // Gold
    if (avgWpm >= 100) return '#c0c0c0';  // Silver
    if (avgWpm >= 80) return '#cd7f32';   // Bronze
    if (avgWpm >= 60) return '#4ec9b0';   // Teal
    if (avgWpm >= 40) return '#569cd6';   // Blue
    return '#808080';  // Gray
}
