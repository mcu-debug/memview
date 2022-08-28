
import * as vscode from 'vscode';
import querystring from 'node:querystring';
// import * as path from 'path';
import { DebugTrackerFactory } from './view/memview/debug-tracker';
import { /*MemviewDocumentProvider, */ MemViewPanelProvider } from './view/memview/memview-doc';

/**
 * It is best to add a new memory view when a debug session is active and in stopped
 * status. Otherwise, there has to be a lot of guessing and we may not always get it right
 * or get it right immediately.
 *
 * Note that once we match a memory view with a debug session, we start tracking it for
 * future invocations and automatically bind to a new session. Of course, this can fail
 * if the session name changes or workspace folder changes.
 */
export interface MemviewUriOptions {
    /**
     * `expr` can be a constant memory address or an expression resulting in an address by debugger using evaluate().
     * URI path is used if no expr is specified
     */
    expr?: string;

    /**
     * We try to derive most of the following if not specified. If sessionId is specified, it should
     * be a currently running debugger (may not be active session). When we can't match the active
     * debug session with what the sessionId given, we may defer to until later.
     */
    sessionId?: string | 'current';     // Undefined also means 'current' if there is an active session

    /** If not supplied, use expr or the URI path */
    displayName?: string;

    /**
     * Following to can be used for better matching of an inactive memory view with a later active
     * debug session. Unfortunately, that only works when the debugger starts a new session
     */

    /** Session name for better matching with a future debug session. */
    sessionName?: string;

    /** Workspace folder associated with the debug session for better matching with a future debug session. */
    wsFolder?: string;          // Must be a Uri.toString() of an actual wsFolder for the session
}

class MemView {
    static Extension: MemView;
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

    onDeactivate() {
        MemViewPanelProvider.saveState();
    }

    constructor(public context: vscode.ExtensionContext) {
        MemView.Extension = this;
        try {
            DebugTrackerFactory.register(context);
            // MemviewDocumentProvider.register(context);
            MemViewPanelProvider.register(context);
            // const p = path.join(context.extensionPath, 'package.json');
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
                const options: MemviewUriOptions = {
                    expr: '&buf'
                };
                if (vscode.debug.activeDebugSession) {
                    options.sessionId = vscode.debug.activeDebugSession.id;
                }
                const uri = vscode.Uri.from({
                    scheme: vscode.env.uriScheme,
                    authority: 'haneefdm.memview',
                    path: '/' + encodeURIComponent('&buf'),
                    query: querystring.stringify(options as any)
                });
                console.log('Opening URI', uri.toString());
                vscode.env.openExternal(uri).then((success: boolean) => {
                    console.log(`Operation URI open: success=${success}`);
                }), ((e: any) => {
                    console.error(e);
                });
            }),
            vscode.commands.registerCommand('memview.addMemoryView', MemViewPanelProvider.newMemoryView),
            vscode.workspace.onDidChangeConfiguration(this.onSettingsChanged.bind(this))
        );
    }
}

export function activate(context: vscode.ExtensionContext) {
    new MemView(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
    MemView.Extension.onDeactivate();
    console.log('Deactivating memview');
}
