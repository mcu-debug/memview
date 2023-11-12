
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
     * `memoryReference` is what a debug adapter provides. It is an opaque string representing a location in memory.
     * If this exists, we use it if the there is no `expr`, or if you have an `expr` as a fallback memory location.
     * This is generally provided by automated tools and not something to be manually entered.
     */
    memoryReference?: string;

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
            vscode.commands.registerCommand('mcu-debug.memory-view.toggleMemoryView', this.toggleMemoryView.bind(this)),
            vscode.commands.registerCommand('mcu-debug.memory-view.hello', () => {
                vscode.window.showInformationMessage('memview extension says hello');
            }),
            vscode.commands.registerCommand('mcu-debug.memory-view.uriTest', () => {
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
            // The following will add a memory view. If no arguments are present then the user will be prompted for an expression
            vscode.commands.registerCommand('mcu-debug.memory-view.addMemoryView', (constOrExprOrMemRef?: string, opts?: MemviewUriOptions) => {
                if (this.tracker.isActive()) {
                    MemViewPanelProvider.newMemoryView(constOrExprOrMemRef, opts);
                } else {
                    vscode.window.showErrorMessage('Cannot execute this command as the debug-tracker-vscode extension did not connect properly');
                }
            }),
            vscode.workspace.onDidChangeConfiguration(this.onSettingsChanged.bind(this)),

            /**
             * HACK: I wish there was a way to detect when a new custom editor or a webview opens. We just monitor any changes
             * in tabs ans scan sor newly opened stuff. Please let me know if there is an alternate API
             */
            vscode.window.tabGroups.onDidChangeTabs(this.tabsChanged.bind(this))
        );
    }

    protected async tabsChanged(ev: vscode.TabChangeEvent) {
        if (!vscode.debug.activeDebugSession || !ev.opened || (ev.opened.length === 0)) {
            return;
        }
        const config = vscode.workspace.getConfiguration('memory-view', null);
        const trackingAllowed = config?.get('tracking.duplicateDebuggerMemoryViews', true);
        const trackAllowedSilent = config?.get('tracking.duplicateDebuggerMemoryViewsSilently', false);
        const closeHexEditorAfterDuplicating = config?.get('tracking.closeHexEditorAfterDuplicating', true);
        if (trackingAllowed || trackAllowedSilent) {
            for (const tab of ev.opened) {
                const tabType = tab.input as any;
                const viewType = tabType?.viewType as string;
                const origUri = tabType?.uri as vscode.Uri;
                if (origUri && (viewType === 'hexEditor.hexedit') && (origUri.scheme === 'vscode-debug-memory')) {
                    // console.log('Tab: ', tab.label, origUri.toString());
                    const regEx = /\/(.*)\//;
                    const match = regEx.exec(origUri.path);
                    if (match) {
                        const memRef = match[1];
                        const options: MemviewUriOptions = {
                            expr: memRef
                        };
                        const newUri = vscode.Uri.from({
                            scheme: vscode.env.uriScheme,
                            authority: 'mcu-debug.memory-view',
                            path: '/' + encodeURIComponent(memRef),
                            query: querystring.stringify(options as any)
                        });
                        const existing = MemViewPanelProvider.Provider.findByUri(newUri);
                        if (!existing.doc) {
                            if (trackAllowedSilent) {
                                try {
                                    await MemViewPanelProvider.Provider.handleUri(newUri);
                                    if (closeHexEditorAfterDuplicating) {
                                        try {
                                            const newItem = MemViewPanelProvider.Provider.findByUri(newUri);
                                            if (newItem.doc) {
                                                vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                                            }
                                        }
                                        catch (e) {
                                            // Do nothing
                                        }
                                    }
                                }
                                catch (e) {
                                    vscode.window.showErrorMessage(`newMemoryView failed: ${e}`);
                                }
                            } else {
                                // This will cause a prompt by VSCode
                                vscode.env.openExternal(newUri).then((success: boolean) => {
                                    if (success) {
                                        // console.log(`Operation URI open: success=${success}`);
                                        vscode.window.showInformationMessage('Completed (hopefully) duplicating the HexEditor window. You can change our extension settings, to do this silently. And, optionally close the HexEditor');
                                        if (closeHexEditorAfterDuplicating) {
                                            vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                                        }
                                    } else {
                                        vscode.window.showInformationMessage('Failed to duplicate HexEditor window. Unknown reason. Try the silent method in this extension settings');
                                    }
                                }), ((e: any) => {
                                    console.error(e);
                                });
                            }
                        } else if (closeHexEditorAfterDuplicating) {
                            vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        }
                    }
                }
            }
        }
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
