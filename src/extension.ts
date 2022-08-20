
import * as vscode from 'vscode';
import * as path from 'path';
import { DebuggerTracker, DebugTrackerFactory } from './view/memview/debug-tracker';
import { /*MemviewDocumentProvider, */ MemViewPanelProvider } from './view/memview/memview-doc';


class MemView {
    private toggleMemoryView() {
        const config = vscode.workspace.getConfiguration('memview', null);
        const isEnabled = !config.get('showMemoryPanel', false);
        const panelLocation = config.get('memoryViewLocation', 'panel');
        config.update('showMemoryPanel', isEnabled);
        const status = isEnabled ? `visible in the '${panelLocation}' area` : 'hidden';
        vscode.window.showInformationMessage(`Memory views are now ${status}`);
    }

    private onSettingsChanged(_e: vscode.ConfigurationChangeEvent) {
        this.setContexts();
    }

    private setContexts() {
        const config = vscode.workspace.getConfiguration('memview', null);
        const isEnabled = config.get('showMemoryPanel', false);
        const panelLocation = config.get('memoryViewLocation', 'panel');
        vscode.commands.executeCommand('setContext', 'memview:showMemoryPanel', isEnabled);
        vscode.commands.executeCommand('setContext', 'memview:memoryPanelLocation', panelLocation);
    }

    private addMemoryView() {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            vscode.window.showErrorMessage('There is no active debug session');
            return;
        }
        const ret = DebuggerTracker.isValidSessionForMemory(session.id);
        if (ret !== true) {
            vscode.window.showErrorMessage(`${ret}. Cannot add a memory view`);
            return;
        }
        const options: vscode.InputBoxOptions = {
            title: 'Create new memory view',
            prompt: 'Enter a hex/decimal constant of a C-expression',
            placeHolder: '0x',
        };
        vscode.window.showInputBox(options).then((value: string | undefined) => {
            value = value !== undefined ? value.trim() : '';
            if (value && vscode.debug.activeDebugSession) {
                MemViewPanelProvider.addMemnoryView(vscode.debug.activeDebugSession, value);
            }
        });
    }

    constructor(public context: vscode.ExtensionContext) {
        const p = path.join(context.extensionPath, 'package.json');
        try {
            DebugTrackerFactory.register(context);
            // MemviewDocumentProvider.register(context);
            MemViewPanelProvider.register(context);
            // MemViewPanelProvider.doTest(p);
        }
        catch (e) {
            console.log('Memview extension could not start', e);
        }

        this.setContexts();

        context.subscriptions.push(
            vscode.commands.registerCommand('memview.toggleMemoryView', this.toggleMemoryView.bind(this)),
            vscode.commands.registerCommand('memview.hello', () => {
                vscode.window.showInformationMessage('Hello from memview extension');
            }),
            vscode.commands.registerCommand('memview.addMemoryView', this.addMemoryView.bind(this)),
            vscode.workspace.onDidChangeConfiguration(this.onSettingsChanged.bind(this))
        );
    }
}

export function activate(context: vscode.ExtensionContext) {
    new MemView(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
    console.log('Deactivating memview');
}
