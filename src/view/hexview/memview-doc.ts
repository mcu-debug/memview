import * as vscode from 'vscode';
import querystring from 'node:querystring';
import { readFileSync } from 'node:fs';
import { WebviewDoc, IWebviewDocXfer, ICmdGetMemory, IMemoryInterfaceCommands, ICmdBase, CmdType, IResponse, ICmdSetMemory, ICmdSetByte, IMemviewDocumentOptions } from './webview-doc';

const KNOWN_SCHMES = {
    FILE: 'file',                                            // Only for testing
    VSCODE_DEBUG_MEMORY_SCHEME: 'vscode-debug-memory',       // Used by VSCode core
    CORTEX_DEBUG_MEMORY_SCHEME: 'cortex-debug-memory'        // Used by cortex-debug
};
const KNOWN_SCHEMES_ARRAY = Object.values(KNOWN_SCHMES);

export class MemviewDocument implements vscode.CustomDocument {
    private disposables: vscode.Disposable[] | undefined = [];
    private sessionId: string | undefined;
    private options: IMemviewDocumentOptions = {
        uriString: '',
        isReadonly: true,
        memoryReference: '0x0',
        isFixedSize: false,
        initialSize: 1024,
        bytes: new Uint8Array(0),
        fsPath: ''
    };
    constructor(public uri: vscode.Uri) {
    }

    public getOptions(): IMemviewDocumentOptions {
        return Object.assign({}, this.options);
    }

    async decodeOptionsFromUri(_options?: IMemviewDocumentOptions) {
        Object.assign(this.options, _options);
        this.options.uriString = this.uri.toString();
        this.options.fsPath = this.uri.fsPath;
        if (this.uri.scheme === KNOWN_SCHMES.VSCODE_DEBUG_MEMORY_SCHEME) {
            const p = this.uri.path.split('/');
            if (p.length) {
                this.options.memoryReference = decodeURIComponent(p[0]);
                try {
                    const stat = await vscode.workspace.fs.stat(this.uri);
                    if (stat.permissions === vscode.FilePermission.Readonly) {
                        this.options.isReadonly = true;
                    }
                }
                catch (e) { }
                // vscode's uri.query contains a range but it isn't used so I don't know how to interpret it. See following
                // code from vscode. We don't use displayName either because it is always 'memory'
                /*
                return URI.from({
                    scheme: DEBUG_MEMORY_SCHEME,
                    authority: sessionId,
                    path: '/' + encodeURIComponent(memoryReference) + `/${encodeURIComponent(displayName)}.bin`,
                    query: range ? `?range=${range.fromOffset}:${range.toOffset}` : undefined,
                });
                */
            }
            this.sessionId = this.uri.authority;
        } else if (this.uri.scheme === KNOWN_SCHMES.CORTEX_DEBUG_MEMORY_SCHEME) {
            const opts = querystring.parse(this.uri.query);
            Object.assign(this.options, opts);
            this.sessionId = this.uri.authority;
        } else {
            this.sessionId = undefined;
            const contents = readFileSync(this.uri.fsPath);
            this.options.bytes = contents;
            this.options.initialSize = this.options.bytes.length;
            this.options.isFixedSize = true;
        }
    }

    private provider: MemviewDocumentProvider | undefined;
    private panel: vscode.WebviewPanel | undefined;
    public setEditorHandles(p: MemviewDocumentProvider, webviewPanel: vscode.WebviewPanel) {
        this.provider = p;
        this.panel = webviewPanel;
        this.panel.webview.onDidReceiveMessage(e => this.handleMessage(e), null, this.disposables);
    }

    public handleMessage(e: any) {
        console.log(e);
    }

    dispose(): void {
        // throw new Error("Method not implemented.");
    }
}

export class MemviewDocumentProvider implements vscode.CustomEditorProvider {
    private static readonly viewType = 'memView.memview';
    public static register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.registerCustomEditorProvider(
                MemviewDocumentProvider.viewType,
                new MemviewDocumentProvider(context),
                {
                    supportsMultipleEditorsPerDocument: false
                }
            )
        );
    }
    constructor(public context: vscode.ExtensionContext) {
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<MemviewDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;
    saveCustomDocument(_document: vscode.CustomDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    saveCustomDocumentAs(_document: vscode.CustomDocument, _destination: vscode.Uri, _cancellation: vscode.CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    revertCustomDocument(_document: vscode.CustomDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
        throw new Error('Method not implemented.');
    }
    backupCustomDocument(_document: vscode.CustomDocument, _context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
        throw new Error('Method not implemented.');
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        if (!KNOWN_SCHEMES_ARRAY.includes(uri.scheme.toLocaleLowerCase())) {
            throw new Error(`Unsupported Uri scheme ${uri.scheme}. Allowed schemes are ${KNOWN_SCHEMES_ARRAY.join(', ')}`);
        }
        const document = new MemviewDocument(uri);
        await document.decodeOptionsFromUri();
        return document;
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add the webview to our internal set of active webviews
        // this.webviews.add(document.uri, webviewPanel);
        const memDoc = document as MemviewDocument;
        if (!memDoc) {
            throw new Error('Invalid document type to open');
        }

        webviewPanel.webview.options = {
            enableScripts: true,
        };

        webviewPanel.webview.html = MemviewDocumentProvider.getWebviewContent(
            webviewPanel.webview, this.context, JSON.stringify(memDoc.getOptions()));
        memDoc.setEditorHandles(this, webviewPanel);
    }

    public static getWebviewContent(webview: vscode.Webview, context: vscode.ExtensionContext, initJson: string): string {
        // Convert the styles and scripts for the webview into webview URIs
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'memview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'memview.css')
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );

        const nonce = getNonce();
        const ret = /* html */ `
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
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>Hex Editor</title>
            <script nonce="${nonce}" type="text/javascript">
                window.initialDataFromVSCode = '${initJson}';
            </script>
          </head>
          <body>
          <div id="root"></div>
          <script nonce="${nonce}" src="${scriptUri}" defer></script>
          </body>
        </html>`;
        return ret;
    }
}

export class MemViewPanelProvider implements vscode.WebviewViewProvider {
    private static readonly viewType = 'memview.memView';
    private static Provider: MemViewPanelProvider;
    private webviewView: vscode.WebviewView | undefined;

    public static register(context: vscode.ExtensionContext) {
        MemViewPanelProvider.Provider = new MemViewPanelProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(MemViewPanelProvider.viewType, MemViewPanelProvider.Provider),
        );
    }

    constructor(public context: vscode.ExtensionContext) {
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext<unknown>,
        _token: vscode.CancellationToken): void | Thenable<void> {

        webviewView.webview.options = {
            enableScripts: true,
        };
        webviewView.description = 'View Memory from Debuggers';
        this.webviewView = webviewView;

        console.log('In resolveWebviewView');
        this.webviewView.onDidDispose((_e) => {
            console.log('disposed webView');
            this.webviewView = undefined;
        });

        this.webviewView.onDidChangeVisibility((e) => {
            console.log('Visibility = ', this.webviewView?.visible);
        });
        webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

        this.updateHtmlForInit();
    }

    private handleMessage(msg: any) {
        // console.log('MemViewPanelProvider.onDidReceiveMessage', msg);
        switch (msg?.type) {
            case 'command': {
                const body: any = msg.body as ICmdBase;
                if (!body) { break; }
                switch (body.type) {
                    case CmdType.GetMemory: {
                        const doc = WebviewDoc.getDocumentById(body.sessionId);
                        if (doc) {
                            const memCmd = (body as ICmdGetMemory);
                            doc.getMoreMemory(BigInt(memCmd.addr), memCmd.count).then((b) => {
                                this.postResponse(body, b);
                            });
                        } else {
                            this.postResponse(body, new Uint8Array(0));
                        }
                        break;
                    }
                    case CmdType.GetDocuments: {
                        const docs = [];
                        for (const [_key, value] of Object.entries(WebviewDoc.allDocuments)) {
                            const doc = value.getSerializable();
                            docs.push(doc);
                        }
                        this.postResponse(body, docs);
                        break;
                    }
                    case CmdType.SetByte: {
                        const doc = WebviewDoc.getDocumentById(body.sessionId);
                        if (doc) {
                            const memCmd = (body as ICmdSetByte);
                            doc.setByteLocal(BigInt(memCmd.addr), memCmd.value);
                        }
                        break;
                    }
                    default: {
                        console.log('handleMessage: Unknown command', body);
                    }
                }
                break;
            }
            case 'refresh': {
                break;
            }
        }
    }

    private postResponse(msg: ICmdBase, body: any) {
        const obj: IResponse = {
            type: 'response',
            seq: msg.seq ?? 0,
            command: msg.type,
            body: body
        };
        this.webviewView?.webview.postMessage(obj);
    }

    private updateHtmlForInit() {
        if (this.webviewView) {
            this.webviewView.webview.html = MemviewDocumentProvider.getWebviewContent(
                this.webviewView.webview, this.context, '');
        }
    }

    static doTest(path: string) {
        const props: IWebviewDocXfer = {
            sessionId: getNonce(),
            displayName: '0xdeadbeef',
            startAddress: '0',
            isReadOnly: false,
            isCurrentDoc: true,
        };
        const buf = readFileSync(path);
        WebviewDoc.init(new mockDebugger(buf, 0n));
        const newDoc = new WebviewDoc(props);
        MemViewPanelProvider.Provider.updateHtmlForInit();
    }
}

class mockDebugger implements IMemoryInterfaceCommands {
    constructor(private testBuffer: Uint8Array, private startAddress: bigint) {
    }
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array> {
        const start = Number(BigInt(arg.addr) - this.startAddress);
        const end = start + arg.count;
        const bytes = this.testBuffer.slice(
            start > this.testBuffer.length ? this.testBuffer.length : start,
            end > this.testBuffer.length ? this.testBuffer.length : end);
        return Promise.resolve(bytes);
    }
    setMemory(_arg: ICmdSetMemory): Promise<boolean> {
        return Promise.resolve(true);
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

export function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}
