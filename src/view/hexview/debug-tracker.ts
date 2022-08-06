import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import events from 'events';

export const TrackedDebuggers = [
    'cortex-debug',
    'cppdebug'
];

// An event is generated whenever the debugger status changes or when read/write capabilities change/discovered
export interface ISessionEventArg {
    session: ITrackedDebugSession
    frameId?: number;           // May be available if status is 'running' (top of stack of current thread)
}

type DebugSessionSatus = 'started' | 'running' | 'stopped' | 'terminated' | 'unknown';
export interface ITrackedDebugSession {
    session: vscode.DebugSession;
    canWriteMemory: boolean | undefined;
    canReadMemory: boolean | undefined;
    status: DebugSessionSatus;
}

export class DebuggerTracker implements vscode.DebugAdapterTracker {
    static EventEmitter = new events.EventEmitter();

    private static allSessionsById: {[sessionId: string]: ITrackedDebugSession} = {};
    private static allSessionsByConfigName: {[configName: string]: ITrackedDebugSession} = {};

    private lastFrameId: number | undefined = undefined;
    constructor(public session: vscode.DebugSession) {
        if (TrackedDebuggers.includes(session.type)) {
            const props: ITrackedDebugSession = {
                session: session,
                canWriteMemory: undefined,
                canReadMemory: undefined,
                status: 'unknown'
            };
            DebuggerTracker.allSessionsById[session.id] = props;
            DebuggerTracker.allSessionsByConfigName[session.name] = props;
            DebuggerTracker.setStatus(session, 'started');
        }
    }

    public onDidSendMessage(msg: any): void {
        appendMsgToTmpDir('s ' + JSON.stringify(msg));
        const message = msg as DebugProtocol.ProtocolMessage;
        if (!message) {
            return;
        }
        switch (message.type) {
            case 'event': {
                const ev: DebugProtocol.Event = message as DebugProtocol.Event;
                if (ev) {
                    if (ev.event === 'stopped') {
                        this.lastFrameId = undefined;
                    } else if (ev.event === 'continued') {
                        // cppdbg does not issue a continued event
                        DebuggerTracker.setStatus(this.session, 'running');
                    } else if (ev.event === 'capabilities') {
                        const capabilities = ev.body?.capabilities as DebugProtocol.Capabilities;
                        if (capabilities) {
                            DebuggerTracker.setCapabilities(this.session, capabilities);
                        }
                    }
                }
                break;
            }
            case 'response': {
                const rsp: DebugProtocol.Response = message as DebugProtocol.Response;
                if (rsp) {
                    const continueCommands = ['continue', 'reverseContinue', 'step', 'stepIn', 'stepOut', 'stepBack', 'next', 'goto'];
                    // We don't actually do anything when the session is paused. We wait until someone (VSCode) makes
                    // a stack trace request and we get the frameId from there. Any one will do. Either this or we
                    // have to make our requests for threads, scopes, stackTrace, etc. Unnecessary traffic and work
                    // for the adapter. Downside is if no stackTrace is requested by someone else, then we don't do anything
                    // but then who is the main client for the adapter?
                    if (rsp.command === 'stackTrace') {
                        if (
                            rsp.body?.stackFrames &&
                            rsp.body.stackFrames.length > 0 &&
                            this.lastFrameId === undefined
                        ) {
                            this.lastFrameId = rsp.body.stackFrames[0].id;
                            DebuggerTracker.setStatus(this.session, 'stopped', this.lastFrameId);
                        }
                    } else if (rsp.success && continueCommands.includes(rsp.command)) {
                        DebuggerTracker.setStatus(this.session, 'running');
                    } else if (rsp.command === 'initialize') {
                        const capabilities = rsp.body?.capabilities as DebugProtocol.Capabilities;
                        if (capabilities) {
                            DebuggerTracker.setCapabilities(this.session, capabilities);
                        }
                    }
                }
                break;
            }
            default: {
                // console.log('Unhandled Message type ' + message.type);
                break;
            }
        }
    }

    public onWillReceiveMessage(msg: any) {
        appendMsgToTmpDir('r ' + JSON.stringify(msg));
    }

    public static TrackAllSessions(): vscode.Disposable[] {
        const ret = [
            vscode.debug.onDidStartDebugSession((s: vscode.DebugSession) => {
                if (TrackedDebuggers.includes(s.type)) {
                    DebuggerTracker.setStatus(s, 'running');        // We pretend like it is running when it just started
                }
            }),
            vscode.debug.onDidTerminateDebugSession((s: vscode.DebugSession) => {
                if (TrackedDebuggers.includes(s.type)) {
                    DebuggerTracker.setStatus(s, 'terminated');
                    delete DebuggerTracker.allSessionsById[s.id];
                }
            })
        ];
        return ret;
    }

    private static setStatus(s: vscode.DebugSession, status: DebugSessionSatus, frameId?: number) {
        const props = DebuggerTracker.allSessionsById[s.id];
        if (props && (props.status !== status)) {
            props.status = status;
            const arg: ISessionEventArg = {
                session: props,
                frameId: frameId
            };
            DebuggerTracker.EventEmitter.emit(status, arg);
        }
    }

    private static setCapabilities(s: vscode.DebugSession, capabilities: DebugProtocol.Capabilities) {
        const props = DebuggerTracker.allSessionsById[s.id];
        props.canReadMemory = !!capabilities?.supportsReadMemoryRequest;
        props.canWriteMemory = !!capabilities?.supportsWriteMemoryRequest;
        DebuggerTracker.EventEmitter.emit('capabilities', props);
    }
}

export class DebugTrackerFactory implements vscode.DebugAdapterTrackerFactory {
    static context: vscode.ExtensionContext;
    public static register(cxt: vscode.ExtensionContext): DebugTrackerFactory {
        DebugTrackerFactory.context = cxt;
        return new DebugTrackerFactory();
    }
    constructor() {
        DebugTrackerFactory.context.subscriptions.push(
            ...DebuggerTracker.TrackAllSessions(),
            vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this))
        );
        TrackedDebuggers.map((debuggerType) => {
            DebugTrackerFactory.context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory(debuggerType, this));
        });
        this.updateTrackedDebuggersFromSettings();
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration('memview.trackDebuggers')) {
            this.updateTrackedDebuggersFromSettings();
        }
    }

    private updateTrackedDebuggersFromSettings() {
        const config = vscode.workspace.getConfiguration('memview', null);
        const prop = config.get('trackDebuggers', []);
        if (prop && Array.isArray(prop)) {
            for (let ix = 0; ix < prop.length; ix++) {
                if (!TrackedDebuggers.includes(prop[ix])) {
                    DebugTrackerFactory.context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory(prop[ix], this));
                }
            }
        }
    }

    public createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        return new DebuggerTracker(session);
    }
}

function appendMsgToTmpDir(str: string) {
    try {
        // eslint-disable-next-line no-constant-condition
        if (false) {
            const fname = path.join(os.tmpdir(), 'rtos-msgs.txt');
            console.log(`Write ${str} to file ${fname}`);
            if (!str.endsWith('\n')) {
                str = str + '\n';
            }
            fs.appendFileSync(fname, str);
        }
    }
    catch (e: any) {
        console.log(e ? e.toString() : 'unknown exception?');
    }
}


