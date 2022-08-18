
import * as vscode from 'vscode';
import * as path from 'path';
import { DebugTrackerFactory } from './view/hexview/debug-tracker';
import { /*MemviewDocumentProvider, */ MemViewPanelProvider } from './view/hexview/memview-doc';

export function activate(context: vscode.ExtensionContext) {
    const p = path.join(context.extensionPath, 'package.json');
    try {
        DebugTrackerFactory.register(context);
        // MemviewDocumentProvider.register(context);
        MemViewPanelProvider.register(context);
        MemViewPanelProvider.doTest(p);
    }
    catch (e) {
        console.log('Memview extension could not start', e);
    }

    setContexts();

    context.subscriptions.push(
        vscode.commands.registerCommand('memview.toggleMemoryView', toggleMemoryView),
        vscode.commands.registerCommand('memview.hello', () => {
            vscode.window.showInformationMessage('Hello from memview extension');
        }),
        vscode.workspace.onDidChangeConfiguration(onSettingsChanged)
    );
}

function toggleMemoryView() {
    const config = vscode.workspace.getConfiguration('memview', null);
    const isEnabled = !config.get('showMemoryPanel', false);
    const panelLocation = config.get('memoryViewLocation', 'panel');
    config.update('showMemoryPanel', isEnabled);
    const status = isEnabled ? `visible in the '${panelLocation}' area` : 'hidden';
    vscode.window.showInformationMessage(`Memory views are now ${status}`);
}

function onSettingsChanged(_e: vscode.ConfigurationChangeEvent) {
    setContexts();
}

function setContexts() {
    const config = vscode.workspace.getConfiguration('memview', null);
    const isEnabled = config.get('showMemoryPanel', false);
    const panelLocation = config.get('memoryViewLocation', 'panel');
    vscode.commands.executeCommand('setContext', 'memview:showMemoryPanel', isEnabled);
    vscode.commands.executeCommand('setContext', 'memview:memoryPanelLocation', panelLocation);
}



// this method is called when your extension is deactivated
export function deactivate() {
    console.log('Deactivating memview');
}
