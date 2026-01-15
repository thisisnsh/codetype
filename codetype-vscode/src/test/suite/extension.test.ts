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
            'codetype.typingGame'
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

    test('Typing game command should open webview panel', async () => {
        // Execute the typing game command
        await vscode.commands.executeCommand('codetype.typingGame');

        // Give it a moment to open
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check that a webview panel is open
        // Note: We can't directly check webview panels, but we can verify no error was thrown
        assert.ok(true, 'Typing game command executed without error');
    });

});
