import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export class HexViewLoader {
  private readonly _panel: vscode.WebviewPanel | undefined;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  constructor(fileUri: vscode.Uri | undefined, extensionPath: string) {
    this._extensionPath = extensionPath;

    let data;
    try {
      if (fileUri) {
        data = fs.readFileSync(fileUri.fsPath, null);
      }
    }
    catch (e) {}
    if (!data) {
      data = new Uint8Array(234);
      for (let ix = 0; ix < data.length; ix++) {
        data[ix] = Math.round(Math.random() * 255);
      }
    }

    if (data) {
      this._panel = vscode.window.createWebviewPanel(
        "hexview",
        "Hex View",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(extensionPath, "dist", "hexview"))
          ]
        }
      );

      this._panel.webview.html = this.getWebviewContent(data);

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

  private getWebviewContent(data: Uint8Array): string {
    // Local path to main script run in the webview
    const reactAppPathOnDisk = vscode.Uri.file(
      path.join(this._extensionPath, "dist", "hexview", "hexview.js")
    );
    const reactAppUri = reactAppPathOnDisk.with({ scheme: "vscode-resource" });
    return /*html*/`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Config View</title>

        <meta http-equiv="Content-Security-Policy"
                    content="default-src 'none';
                             img-src https:;
                             script-src 'unsafe-eval' 'unsafe-inline' vscode-resource:;
                             style-src vscode-resource: 'unsafe-inline';">

        <script>
          window.acquireVsCodeApi = acquireVsCodeApi;
          window.initialData = ${data};
        </script>
    </head>
    <body>
        <div id="root"></div>
        <script src="${reactAppUri}"></script>
    </body>
    </html>`;
  }
}
