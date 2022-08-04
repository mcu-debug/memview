
import * as vscode from "vscode";
import { HexViewLoader } from "./view/hexviewloader";
import { DebugTrackerFactory } from "./view/hexview/debug-tracker";
import { MemviewDocumentProvider } from "./view/hexview/memview-doc";

export function activate(context: vscode.ExtensionContext) {
	console.log("Congratulations, your extension \"memview\" is now active!");
	const disposable = vscode.commands.registerCommand("memview.helloWorld", () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage("Hello World from memview!");
		const blah = new HexViewLoader(undefined, context);
	});

	context.subscriptions.push(disposable);
    new DebugTrackerFactory(context);
    MemviewDocumentProvider.register(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
	console.log("Deactivating memview");
}
