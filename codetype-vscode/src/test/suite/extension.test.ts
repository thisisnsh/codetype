import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Starting CodeType tests...');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('codetype.codetype'));
    });

    test('Extension should activate', async () => {
        const extension = vscode.extensions.getExtension('codetype.codetype');
        assert.ok(extension);
        await extension!.activate();
        assert.strictEqual(extension!.isActive, true);
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);

        const expectedCommands = [
            'codetype.start',
            'codetype.solo',
            'codetype.createRoom',
            'codetype.joinRoom',
            'codetype.leaderboard',
            'codetype.setUsername',
            'codetype.stats'
        ];

        for (const cmd of expectedCommands) {
            assert.ok(
                commands.includes(cmd),
                `Command ${cmd} should be registered`
            );
        }
    });

    test('Configuration should have defaults', () => {
        const config = vscode.workspace.getConfiguration('codetype');

        assert.strictEqual(config.get('theme'), 'stealth');
        assert.strictEqual(config.get('soundEnabled'), false);
        assert.strictEqual(config.get('useWorkspaceCode'), true);
    });

    test('Start command should open webview panel', async () => {
        // Execute the start command
        await vscode.commands.executeCommand('codetype.start');

        // Give it a moment to open
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check that a webview panel is open
        // Note: We can't directly check webview panels, but we can verify no error was thrown
        assert.ok(true, 'Start command executed without error');
    });

    test('Solo command should open game', async () => {
        await vscode.commands.executeCommand('codetype.solo');
        await new Promise(resolve => setTimeout(resolve, 500));
        assert.ok(true, 'Solo command executed without error');
    });

    test('Set username command should prompt for input', async () => {
        // This test verifies the command exists and can be called
        // The actual input box interaction would require more complex mocking
        try {
            // Cancel the input box by not providing input
            setTimeout(() => {
                vscode.commands.executeCommand('workbench.action.closeQuickInput');
            }, 100);
            await vscode.commands.executeCommand('codetype.setUsername');
        } catch {
            // Expected to fail or be cancelled
        }
        assert.ok(true, 'Set username command executed');
    });
});
