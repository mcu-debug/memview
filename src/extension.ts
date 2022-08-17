
import * as vscode from 'vscode';
import * as path from 'path';
import { DebugTrackerFactory } from './view/hexview/debug-tracker';
import { MemviewDocumentProvider, MemViewPanelProvider } from './view/hexview/memview-doc';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "memview" is now active!');
    const p = path.join(context.extensionPath, 'package.json');
    let disposable = vscode.commands.registerCommand('memview.memView', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        // vscode.window.showInformationMessage("Hello World from memview!");
        // const blah = new HexViewLoader(undefined, context);
        // vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(p), 'memView.memview');
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('memview.memView2', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        // vscode.window.showInformationMessage("Hello World from memview!");
        // const blah = new HexViewLoader(undefined, context);
        // MemViewPanelProvider.doTest(p);
        console.log('in hello world2');
    });
    context.subscriptions.push(disposable);

    DebugTrackerFactory.register(context);
    MemviewDocumentProvider.register(context);
    MemViewPanelProvider.register(context);
    MemViewPanelProvider.doTest(p);
}

// this method is called when your extension is deactivated
export function deactivate() {
    console.log('Deactivating memview');
}
