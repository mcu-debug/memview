import * as vscode from 'vscode';
import querystring from 'node:querystring';
import { uuid } from 'uuidv4';
import * as fs from 'fs';
import { DocDebuggerStatus, DualViewDoc } from './dual-view-doc';
import { MemViewExtension, MemviewUriOptions } from '../../extension';
import {
    IWebviewDocXfer, ICmdGetMemory, IMemoryInterfaceCommands, ICmdBase, CmdType,
    IMessage, ICmdSetMemory, ICmdSetByte, IMemviewDocumentOptions, ITrackedDebugSessionXfer,
    ICmdClientState, ICmdGetStartAddress, ICmdButtonClick, ICmdSettingsChanged, UnknownDocId
} from './shared';
import { DebuggerTrackerLocal } from './debug-tracker';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DebugSessionStatus } from 'debug-tracker-vscode';
import { hexFmt64 } from './utils';

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
            const contents = fs.readFileSync(this.uri.fsPath);
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
    private static readonly viewType = 'memory-view.memoryView';
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

export class MemViewPanelProvider implements vscode.WebviewViewProvider, vscode.UriHandler {
    private static context: vscode.ExtensionContext;
    private static readonly viewType = 'memory-view.memoryView';
    private static readonly stateVersion = 1;
    private static readonly stateKeyName = 'documents';
    private static Provider: MemViewPanelProvider;
    private webviewView: vscode.WebviewView | undefined;

    public static register(context: vscode.ExtensionContext) {
        MemViewPanelProvider.context = context;
        MemViewPanelProvider.Provider = new MemViewPanelProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                MemViewPanelProvider.viewType, MemViewPanelProvider.Provider, {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }),
            vscode.window.registerUriHandler(MemViewPanelProvider.Provider)
        );
        DualViewDoc.init(new DebuggerIF());
        try {
            const ver = context.workspaceState.get('version');
            if (ver === MemViewPanelProvider.stateVersion) {
                const obj = context.workspaceState.get(MemViewPanelProvider.stateKeyName);
                const saved = obj as IWebviewDocXfer[];
                if (saved) {
                    DualViewDoc.restoreSerializableAll(saved);
                }
            }
        }
        catch (e) {
            DualViewDoc.restoreSerializableAll([]);
        }
    }

    constructor(public context: vscode.ExtensionContext) {
        MemViewPanelProvider.context = context;
        DebuggerTrackerLocal.eventEmitter.on('any', this.debuggerStatusChanged.bind(this));
    }

    handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
        const options = querystring.parse(uri.query);
        const cvt = (value: string | string[] | undefined): string | undefined => {
            return value === undefined ? undefined : (Array.isArray(value) ? value.join(',') : value);
        };
        const trimSlashes = (path: string): string => {
            while (path.startsWith('/')) {
                path = path.substring(1);
            }
            while (path.endsWith('/')) {
                path = path.substring(0, path.length - 1);
            }
            return path;
        };
        const path = trimSlashes(decodeURIComponent(uri.path ?? ''));
        const expr = cvt(options.expr) || cvt(options.memoryReference);
        if (!expr && !path) {
            return Promise.reject(new Error('MemView URI handler: No expression or path provided'));
        }

        let session = vscode.debug.activeDebugSession;
        const optSessionId = cvt(options.sessionId);
        const useCurrent = (!optSessionId || optSessionId === 'current');
        const sessionId = useCurrent && session ? session.id : optSessionId || session?.id || uuid();
        const sessionInfo = DebuggerTrackerLocal.getSessionById(sessionId);
        if (sessionInfo) {
            session = sessionInfo.session;
        }

        // Someone can sneak-ing debugger we don't support, but then it will never work as we will never
        // attach to such a debugger. But it will get into our document list
        const props: IWebviewDocXfer = {
            docId: uuid(),
            sessionId: sessionId,
            sessionName: session?.name || cvt(options.sessionName) || '',
            displayName: cvt(options.displayName) || path || expr || '0',
            expr: expr || path,
            wsFolder: session?.workspaceFolder?.uri.toString() || cvt(options.wsFolder) || '',
            startAddress: '',
            endian: 'little',
            format: '1-byte',
            isReadOnly: !sessionInfo?.canWriteMemory,
            clientState: {},
            baseAddressStale: true,
            isCurrentDoc: true,
        };

        const existing = DualViewDoc.findDocumentIfExists(props);
        if (existing) {
            MemViewPanelProvider.Provider.showPanel();
            if (existing !== DualViewDoc.currentDoc) {
                DualViewDoc.setCurrentDoc(existing.docId);
                this.updateHtmlForInit();
            }
            return;
        }

        if (sessionInfo && sessionInfo.status === DebugSessionStatus.Stopped) {
            MemViewPanelProvider.getExprResult(sessionInfo.session, props.expr).then((addr) => {
                props.baseAddressStale = false;
                props.startAddress = addr;
                new DualViewDoc(props);
                MemViewPanelProvider.Provider.showPanel();
            }).catch((e) => {
                vscode.window.showErrorMessage(`Error: Bad expression in Uri '${expr}'. ${e}`);
                return Promise.reject(new Error(`MemView URI handler: Expression ${expr} failed to evaluate: ${e}`));
            });
        } else {
            let msg = `MemView URI handler: New view for ${props.expr} added. It will have contents updated when program is paused or started.`;
            if (DualViewDoc.currentDoc) {       // There is already one!
                props.isCurrentDoc = false;
                msg += ' You will have to change the current view manually since there is already a view displayed';
            }
            vscode.window.showInformationMessage(msg);
            new DualViewDoc(props);
            MemViewPanelProvider.Provider.showPanel();
        }
    }

    static saveState() {
        const state = MemViewPanelProvider.context.workspaceState;
        const obj = DualViewDoc.storeSerializableAll(true);
        state.update('version', MemViewPanelProvider.stateVersion);
        state.update(MemViewPanelProvider.stateKeyName, obj);
        // console.log('Finished saving state');
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

        // console.log('In resolveWebviewView');
        this.webviewView.onDidDispose((_e) => {
            // This is never called when extension exits
            // console.log('disposed webView');
            this.webviewView = undefined;
            MemViewPanelProvider.saveState();
        });

        this.webviewView.onDidChangeVisibility(() => {
            // console.log('Visibility = ', this.webviewView?.visible);
        });
        webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

        this.updateHtmlForInit();
    }

    public dumpAllToClipboard(doc: DualViewDoc): Promise<void> {
        return new Promise<void>((resolve) => {
            const lines: string[] = [];
            this.dumpAll(doc, (line) => {
                lines.push(line);
            }).then(() => {
                vscode.env.clipboard.writeText(lines.join('\n'));
            }).catch((e) => {
                console.error('MemView: dumpAll Failed?!?!', e);
            }).finally(() => {
                resolve();
            });
        });
    }

    public dumpAllToFile(doc: DualViewDoc): Promise<void> {
        return new Promise<void>((resolve) => {
            const opts: vscode.SaveDialogOptions = {
                filters: {
                    'Text files': ['*.txt', '*.dat']
                },
                saveLabel: 'Save',
                title: 'Select text file for writing'
            };
            vscode.window.showSaveDialog(opts).then((uri) => {
                if (uri) {
                    const stream = fs.createWriteStream(uri.fsPath);
                    stream.on('error', (e) => {
                        vscode.window.showErrorMessage(`Could not open file name "${uri}" for writing: ${e}`);
                        resolve();
                    });
                    stream.on('ready', () => {
                        this.dumpAll(doc, (line) => {
                            stream.write(line);
                            stream.write('\n');
                        }).then(() => {
                            stream.end();
                        }).catch((e) => {
                            console.error('MemView: dumpAll Failed?!?!', e);
                        }).finally(() => {
                            resolve();
                        });
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    public async dumpAll(doc: DualViewDoc, cb: (line: string) => void) {
        if (doc.sessionStatus === DocDebuggerStatus.Stopped) {
            try {
                // Don't care if we cannot refresh. Dump what we got
                await doc.refreshMemoryIfStale();
            }
            finally { }
        }
        const memory = doc.getMemoryRaw();
        let base = memory.baseAddress;
        for (let pageIx = 0; pageIx < memory.numPages(); pageIx++, base += BigInt(DualViewDoc.PageSize)) {
            const page = memory.getPage(base);
            if (page && page.length) {
                let addr = base;
                let line: string[] = [hexFmt64(addr, false)];
                for (let ix = 0; ix < page.length; ix++) {
                    if (line.length === 17) {
                        cb && cb(line.join(' '));
                        addr += 16n;
                        line = [hexFmt64(addr, false)];
                    }
                    line.push(page[ix].toString(16).padStart(2, '0'));
                }
                (line.length > 1) && cb && cb(line.join(' '));
            }
        }
    }

    private handleMessage(msg: any) {
        // console.log('MemViewPanelProvider.onDidReceiveMessage', msg);
        switch (msg?.type) {
            case 'command': {
                const body: ICmdBase = msg.body as ICmdBase;
                if (!body) { break; }
                switch (body.type) {
                    case CmdType.GetDebuggerSessions: {
                        this.sendAllDebuggerSessions(body);
                        break;
                    }
                    case CmdType.GetStartAddress: {
                        const doc = DualViewDoc.getDocumentById(body.docId);
                        const memCmd = (body as ICmdGetStartAddress);
                        if (doc) {
                            const oldAddr = doc.startAddress;
                            doc.getStartAddress().then((v) => {
                                if (oldAddr !== v) {
                                    // Do it the lazy way for now.
                                    this.updateHtmlForInit();
                                } else {
                                    this.postResponse(body, v.toString());
                                }
                            });
                        } else {
                            this.postResponse(body, memCmd.def);
                        }
                        break;
                    }
                    case CmdType.GetMemory: {
                        const doc = DualViewDoc.getDocumentById(body.docId);
                        if (doc) {
                            const memCmd = (body as ICmdGetMemory);
                            doc.getMemoryPage(BigInt(memCmd.addr), memCmd.count).then((b) => {
                                this.postResponse(body, b);
                            });
                        } else {
                            this.postResponse(body, new Uint8Array(0));
                        }
                        break;
                    }
                    case CmdType.GetDocuments: {
                        const docs = DualViewDoc.storeSerializableAll();
                        this.postResponse(body, docs);
                        break;
                    }
                    case CmdType.SetByte: {
                        const doc = DualViewDoc.getDocumentById(body.docId);
                        if (doc) {
                            const memCmd = (body as ICmdSetByte);
                            doc.setByteLocal(BigInt(memCmd.addr), memCmd.value);
                        }
                        break;
                    }
                    case CmdType.SaveClientState: {
                        const doc = DualViewDoc.getDocumentById(body.docId);
                        if (doc) {
                            doc.setClientStateAll((body as ICmdClientState).state);
                        }
                        break;
                    }
                    case CmdType.ButtonClick: {
                        const doc = body.docId && body.docId !== UnknownDocId ? DualViewDoc.getDocumentById(body.docId) : undefined;
                        const button = (body as ICmdButtonClick).button;
                        switch (button) {
                            case 'close': {
                                DualViewDoc.removeDocument(body.docId);
                                this.updateHtmlForInit();
                                break;
                            }
                            case 'new': {
                                MemViewPanelProvider.newMemoryView();
                                break;
                            }
                            case 'select': {
                                DualViewDoc.setCurrentDoc(body.docId);
                                this.updateHtmlForInit();
                                break;
                            }
                            case 'refresh': {
                                DualViewDoc.markAllDocsStale();
                                this.updateHtmlForInit();
                                break;
                            }
                            case 'copy-all-to-clipboard': {
                                doc && this.dumpAllToClipboard(doc);
                                break;
                            }
                            case 'copy-all-to-file': {
                                doc && this.dumpAllToFile(doc);
                                break;
                            }
                        }
                        break;
                    }
                    case CmdType.SettingsChanged: {
                        const doc = DualViewDoc.getDocumentById(body.docId);
                        const newSettings = (body as ICmdSettingsChanged)?.settings;
                        if (doc && newSettings) {
                            if ((doc.expr !== newSettings.expr) && (doc.sessionStatus !== DocDebuggerStatus.Stopped)) {
                                vscode.window.showInformationMessage(`Memory view expression changed to ${newSettings.expr}. ` +
                                    'The view contents will be updated the next time the debugger is paused');
                            }
                            doc.updateSettings((body as ICmdSettingsChanged).settings);
                            this.updateHtmlForInit();
                        }
                        break;
                    }
                    default: {
                        console.error('handleMessage: Unknown command', body);
                        break;
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
        const obj: IMessage = {
            type: 'response',
            seq: msg.seq ?? 0,
            command: msg.type,
            body: body
        };
        this.webviewView?.webview.postMessage(obj);
    }

    private postNotice(msg: ICmdBase, body: any) {
        const obj: IMessage = {
            type: 'notice',
            seq: msg.seq ?? 0,
            command: msg.type,
            body: body
        };
        this.webviewView?.webview.postMessage(obj);
    }

    private debuggerStatusChanged(arg: ITrackedDebugSessionXfer) {
        DualViewDoc.debuggerStatusChanged(arg.sessionId, arg.status, arg.sessionName, arg.wsFolder);
        if (this.webviewView) {
            const msg: ICmdBase = {
                type: CmdType.DebugerStatus,
                sessionId: arg.sessionId,
                docId: ''
            };
            this.postNotice(msg, arg);
            if (arg.status === DebugSessionStatus.Terminated) {
                MemViewPanelProvider.saveState();
            }
        }
    }

    private sendAllDebuggerSessions(msg: ICmdBase) {
        if (this.webviewView?.visible) {
            const allSessions = DebuggerTrackerLocal.getCurrentSessionsSerializable();
            this.postResponse(msg, allSessions);
        }
    }

    private updateHtmlForInit() {
        if (this.webviewView) {
            this.webviewView.webview.html = MemviewDocumentProvider.getWebviewContent(
                this.webviewView.webview, this.context, '');
        }
        MemViewPanelProvider.saveState();
    }

    private async showPanel(refresh = true) {
        if (!this.webviewView || !this.webviewView.visible) {
            // Following will automatically refresh
            try {
                await MemViewExtension.enableMemoryView();
            }
            catch {
                console.error('Why did  MemViewExtension.enableMemoryView() fail');
            }
            vscode.commands.executeCommand(MemViewPanelProvider.viewType + '.focus');
        } else if (refresh) {
            MemViewPanelProvider.Provider.updateHtmlForInit();
        }
    }

    static addMemoryView(session: vscode.DebugSession, expr: string) {
        expr = expr.trim();
        MemViewPanelProvider.getExprResult(session, expr).then((addr) => {
            const sessonInfo = DebuggerTrackerLocal.getSessionById(session.id);
            const props: IWebviewDocXfer = {
                docId: uuid(),
                sessionId: session.id,
                sessionName: session.name,
                displayName: expr,
                expr: expr,
                endian: 'little',
                format: '1-byte',
                wsFolder: session.workspaceFolder?.uri.toString() || '.',
                startAddress: addr,
                isReadOnly: !sessonInfo.canWriteMemory,
                clientState: {},
                baseAddressStale: false,
                isCurrentDoc: true,
            };
            const existing = DualViewDoc.findDocumentIfExists(props);
            if (existing) {
                if (existing !== DualViewDoc.currentDoc) {
                    DualViewDoc.setCurrentDoc(existing.docId);
                    MemViewPanelProvider.Provider.updateHtmlForInit();
                    MemViewPanelProvider.Provider.showPanel();
                }
            } else {
                new DualViewDoc(props);
                MemViewPanelProvider.Provider.showPanel();
            }
        }).catch((e) => {
            vscode.window.showErrorMessage(`Error: Bad expression '${expr}'. ${e}`);
        });
    }

    public static newMemoryView(expr?: string, opts?: MemviewUriOptions | any) {
        if (typeof expr !== 'string' || !expr) {
            expr = undefined;
        }

        if (!expr) {
            if (opts && (typeof opts.expr === 'string')) {
                expr = opts.expr;
            } else if (opts && (typeof opts.memoryReference === 'string')) {
                expr = opts.memoryReference;
            }
        }

        if (expr) {
            opts = opts || {};
            opts.expr = expr;
            if (!opts.sessionId && vscode.debug.activeDebugSession) {
                opts.sessionId = vscode.debug.activeDebugSession.id;
            }
            const uri = vscode.Uri.from({
                scheme: vscode.env.uriScheme,
                authority: 'mcu-debug.memory-view',
                path: '/' + encodeURIComponent(expr),
                query: querystring.stringify(opts as any)
            });
            MemViewPanelProvider.Provider.handleUri(uri)?.then(undefined, (e: any) => {
                vscode.window.showErrorMessage(`newMemoryView failed: ${e}`);
            });
            return;
        }

        const session = vscode.debug.activeDebugSession;
        if (!session) {
            vscode.window.showErrorMessage('There is no active debug session');
            return;
        }
        const ret = DebuggerTrackerLocal.isValidSessionForMemory(session.id);
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
                MemViewPanelProvider.addMemoryView(vscode.debug.activeDebugSession, value);
            }
        });
    }

    static getExprResult(session: vscode.DebugSession, expr: string): Promise<string> {
        const isHexOrDec = (expr: string): boolean => {
            return /^0x[0-9a-f]+$/i.test(expr) || /^[0-9]+$/.test(expr);
        };
        if (isHexOrDec(expr)) {
            return Promise.resolve(expr);
        }
        return new Promise<string>((resolve, reject) => {
            const tmp = DebuggerTrackerLocal.getSessionById(session.id);
            const arg: DebugProtocol.EvaluateArguments = {
                expression: expr,
                context: 'hover'
            };
            if (tmp?.lastFrameId !== undefined) {
                arg.frameId = tmp.lastFrameId;
            }
            session.customRequest('evaluate', arg).then((result) => {
                if (result.memoryReference) {
                    resolve(result.memoryReference);
                    return;
                }
                if (result.result) {
                    let res: string = result.result.trim().toLocaleLowerCase();
                    if (res.startsWith('0x')) {
                        const ary = res.match(/^0x[0-9a-f]+/);
                        if (ary) {
                            res = ary[1];
                            resolve(res);
                            return;
                        }
                    }
                    reject(new Error(`Expression '${expr}' failed to evaluate to a proper pointer value. Result: '${res}'`));
                } else {
                    reject(new Error(`Expression '${expr}' failed to yield a proper result. Got ${JSON.stringify(result)}`));
                }
            }), (e: any) => {
                reject(new Error(`Expression '${expr}' threw an error. ${JSON.stringify(e)}`));
            };
        });
    }

    static doTest(path: string) {
        const props: IWebviewDocXfer = {
            docId: uuid(),
            sessionId: getNonce(),
            sessionName: 'blah',
            displayName: '0xdeadbeef',
            expr: '0xdeafbeef',
            format: '1-byte',
            endian: 'little',
            wsFolder: '.',
            startAddress: '0',
            isReadOnly: false,
            clientState: {},
            baseAddressStale: false,
            isCurrentDoc: true,
        };
        const buf = fs.readFileSync(path);
        DualViewDoc.init(new mockDebugger(buf, 0n));
        new DualViewDoc(props);
        MemViewPanelProvider.Provider.updateHtmlForInit();
    }
}

class mockDebugger implements IMemoryInterfaceCommands {
    constructor(private testBuffer: Uint8Array, private baseAddress: bigint) {
    }
    getStartAddress(arg: ICmdGetStartAddress): Promise<string> {
        return Promise.resolve(arg.def);
    }
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array> {
        const start = Number(BigInt(arg.addr) - this.baseAddress);
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

class DebuggerIF implements IMemoryInterfaceCommands {
    getStartAddress(arg: ICmdGetStartAddress): Promise<string> {
        const session = DebuggerTrackerLocal.getSessionById(arg.sessionId);
        if (!session || (session.status !== DebugSessionStatus.Stopped)) {
            return Promise.resolve(arg.def);
        }
        return MemViewPanelProvider.getExprResult(session.session, arg.expr);
    }
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array> {
        const memArg: DebugProtocol.ReadMemoryArguments = {
            memoryReference: arg.addr,
            count: arg.count
        };
        return new Promise<Uint8Array>((resolve) => {
            const session = DebuggerTrackerLocal.getSessionById(arg.sessionId);
            if (!session || (session.status !== DebugSessionStatus.Stopped)) {
                return resolve(new Uint8Array(0));
            }
            session.session.customRequest('readMemory', memArg).then((result) => {
                const buf = Buffer.from(result.data, 'base64');
                const ary = new Uint8Array(buf);
                return resolve(ary);
            }), ((e: any) => {
                debugConsoleMessage(e, arg);
                return resolve(new Uint8Array(0));
            });
        });
    }
    setMemory(_arg: ICmdSetMemory): Promise<boolean> {
        return Promise.resolve(true);
    }
}


function debugConsoleMessage(e: any, arg: ICmdGetMemory) {
    const con = vscode.debug.activeDebugConsole;
    if (con) {
        const msg = e instanceof Error ? e.message : e ? e.toString() : 'Unknown error';
        con.appendLine(`Memview: Failed to read memory @ ${arg.addr}. ` + msg);
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
