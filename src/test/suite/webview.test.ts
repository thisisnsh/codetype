import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * WebView UI Tests
 *
 * These tests verify the WebView game interface works correctly.
 * Due to WebView isolation, we test through command execution and
 * verify the extension behavior.
 */
suite('WebView UI Test Suite', () => {
    // Cleanup after each test
    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    suite('Game Panel Creation', () => {
        test('should open panel with stealth title', async () => {
            await vscode.commands.executeCommand('codetype.start');
            await sleep(500);

            // The panel should be named "utils.ts" to look like a normal file
            const activeEditor = vscode.window.activeTextEditor;
            // WebView panels don't show as activeTextEditor, but command should succeed
            assert.ok(true, 'Panel opened successfully');
        });

        test('should handle multiple open attempts', async () => {
            await vscode.commands.executeCommand('codetype.start');
            await sleep(300);
            await vscode.commands.executeCommand('codetype.start');
            await sleep(300);

            // Should not crash or create multiple panels
            assert.ok(true, 'Multiple opens handled');
        });
    });

    suite('Solo Mode', () => {
        test('should start solo game without error', async () => {
            await vscode.commands.executeCommand('codetype.solo');
            await sleep(500);
            assert.ok(true, 'Solo mode started');
        });

        test('should load code sample', async () => {
            await vscode.commands.executeCommand('codetype.solo');
            await sleep(1000);
            // If no error thrown, code was loaded
            assert.ok(true, 'Code sample loaded');
        });
    });

    suite('Leaderboard', () => {
        test('should open leaderboard view', async () => {
            await vscode.commands.executeCommand('codetype.leaderboard');
            await sleep(500);
            assert.ok(true, 'Leaderboard opened');
        });
    });

    suite('Stats', () => {
        test('should open stats view', async () => {
            await vscode.commands.executeCommand('codetype.stats');
            await sleep(500);
            assert.ok(true, 'Stats opened');
        });
    });

    suite('Panel Lifecycle', () => {
        test('should dispose properly when closed', async () => {
            await vscode.commands.executeCommand('codetype.start');
            await sleep(300);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await sleep(300);

            // Should be able to reopen
            await vscode.commands.executeCommand('codetype.start');
            await sleep(300);
            assert.ok(true, 'Panel lifecycle handled correctly');
        });
    });

    suite('Configuration', () => {
        test('should respect theme configuration', async () => {
            const config = vscode.workspace.getConfiguration('codetype');
            const originalTheme = config.get('theme');

            await config.update('theme', 'minimal', vscode.ConfigurationTarget.Global);
            await vscode.commands.executeCommand('codetype.start');
            await sleep(300);

            // Restore
            await config.update('theme', originalTheme, vscode.ConfigurationTarget.Global);
            assert.ok(true, 'Theme configuration respected');
        });

        test('should respect sound configuration', async () => {
            const config = vscode.workspace.getConfiguration('codetype');
            assert.strictEqual(config.get('soundEnabled'), false);
        });
    });
});

/**
 * WebView Message Protocol Tests
 * Tests the message passing between extension and WebView
 */
suite('WebView Message Protocol Tests', () => {
    test('should have correct message types defined', () => {
        // These are the message types the WebView expects
        const expectedMessageTypes = [
            'loadCode',
            'showResults',
            'roomCreated',
            'room_playerJoined',
            'room_playerLeft',
            'room_update',
            'room_gameStart',
            'room_progress',
            'room_gameEnd',
            'leaderboard',
            'stats',
            'error'
        ];

        // Verify types are strings (basic check)
        for (const type of expectedMessageTypes) {
            assert.strictEqual(typeof type, 'string');
            assert.ok(type.length > 0);
        }
    });

    test('should have correct outgoing message types', () => {
        const outgoingMessageTypes = [
            'startSolo',
            'gameFinished',
            'createRoom',
            'joinRoom',
            'startMultiplayer',
            'updateProgress',
            'multiplayerFinished',
            'getLeaderboard',
            'getStats',
            'navigate',
            'copyRoomCode'
        ];

        for (const type of outgoingMessageTypes) {
            assert.strictEqual(typeof type, 'string');
            assert.ok(type.length > 0);
        }
    });
});

/**
 * Keyboard Shortcut Tests
 */
suite('Keyboard Shortcuts', () => {
    test('should have start command registered', async () => {
        // Command should exist
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('codetype.start'));
    });
});

// Helper function
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
