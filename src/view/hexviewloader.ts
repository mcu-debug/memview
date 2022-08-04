import * as vscode from "vscode";
import * as path from "path";

export class HexViewLoader {
  private readonly _panel: vscode.WebviewPanel | undefined;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  constructor(fileUri: vscode.Uri | undefined, public context: vscode.ExtensionContext) {
    this._extensionPath = context.extensionPath;

    // eslint-disable-next-line no-constant-condition
    if (true) {
      this._panel = vscode.window.createWebviewPanel(
        "memview",
        "Memory View",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );

      this._panel.webview.html = this.getWebviewContent(this._panel.webview);

      /*
      this._panel.webview.onDidReceiveMessage(
        (command: ICommand) => {
          switch (command.action) {
            case CommandAction.Save:
              this.saveFileContent(fileUri, command.content);
              return;
          }
        },
        undefined,
        this._disposables
      );
      */
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    // Convert the styles and scripts for the webview into webview URIs
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "memview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "memview.css"));

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();
    const initialData = new Uint8Array(1024);
    for (let i = 0; i < initialData.length; i++) {
      initialData[i] = Math.floor(Math.random() * 256) & 0xff;
    }

    const ret = /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}
        blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleUri}" rel="stylesheet" />
				<title>Hex Editor</title>
                </head>
			<body>
      <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}" defer></script>
      </body>
			</html>`;
    return ret;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
