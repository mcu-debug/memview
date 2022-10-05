
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

export class MemViewExtension {
    static Extension: MemViewExtension;
    private tracker: DebugTrackerFactory;
    private toggleMemoryView() {
        const config = vscode.workspace.getConfiguration('memory-view', null);
        const isEnabled = !config.get('showMemoryPanel', true);
        const panelLocation = config.get('memoryViewLocation', 'panel');
        config.update('showMemoryPanel', isEnabled);
        const status = isEnabled ? `visible in the '${panelLocation}' area` : 'hidden';
        vscode.window.showInformationMessage(`Memory views are now ${status}`);
    }

    static async enableMemoryView() {
        const config = vscode.workspace.getConfiguration('memory-view', null);
        const isEnabled = config.get('showMemoryPanel', true);
        if (!isEnabled) {
            await config.update('showMemoryPanel', true);
            MemViewExtension.Extension.setContexts();
        }
    }

    private onSettingsChanged(_e: vscode.ConfigurationChangeEvent) {
        this.setContexts();
    }

    private setContexts() {
        const config = vscode.workspace.getConfiguration('memory-view', null);
        const isEnabled = config.get('showMemoryPanel', true);
        const panelLocation = config.get('memoryViewLocation', 'panel');
        vscode.commands.executeCommand('setContext', 'memory-view:showMemoryPanel', isEnabled);
        vscode.commands.executeCommand('setContext', 'memory-view:memoryPanelLocation', panelLocation);
    }

    onDeactivate() {
        MemViewPanelProvider.saveState();
    }

    constructor(public context: vscode.ExtensionContext) {
        MemViewExtension.Extension = this;
        this.tracker = DebugTrackerFactory.register(context);
        // MemviewDocumentProvider.register(context);
        MemViewPanelProvider.register(context);

        this.setContexts();

        context.subscriptions.push(
            vscode.commands.registerCommand('memory-view.toggleMemoryView', this.toggleMemoryView.bind(this)),
            vscode.commands.registerCommand('memory-view.hello', () => {
                const options: MemviewUriOptions = {
                    expr: '&buf'
                };
                if (vscode.debug.activeDebugSession) {
                    options.sessionId = vscode.debug.activeDebugSession.id;
                }
                const uri = vscode.Uri.from({
                    scheme: vscode.env.uriScheme,
                    authority: 'mcu-debug.memory-view',
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
            vscode.commands.registerCommand('memory-view.addMemoryView', () => {
                if (this.tracker.isActive()) {
                    MemViewPanelProvider.newMemoryView();
                } else {
                    vscode.window.showErrorMessage('Cannot execute this command as the debug-tracker-vscode extension did not connect properly');
                }
            }),
            vscode.workspace.onDidChangeConfiguration(this.onSettingsChanged.bind(this))
        );
    }
}

export function activate(context: vscode.ExtensionContext) {
    new MemViewExtension(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
    MemViewExtension.Extension.onDeactivate();
    console.log('Deactivating memview');
}
