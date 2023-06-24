import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import events from 'events';
import { ITrackedDebugSessionXfer } from './shared';

import {
    IDebugTracker,
    IDebuggerTrackerSubscribeArg,
    IDebuggerTrackerEvent,
    IDebuggerSubscription,
    OtherDebugEvents,
    DebugSessionStatus,
    DebugTracker,
} from 'debug-tracker-vscode';

let trackerApi: IDebugTracker;
let trackerApiClientInfo: IDebuggerSubscription;

export const TrackedDebuggers = [
    'cortex-debug',
    'cppdbg',       // Microsoft debugger
    'cspy'          // IAR debugger
];

export interface ITrackedDebugSession {
    session: vscode.DebugSession;
    canWriteMemory: boolean | undefined;
    canReadMemory: boolean | undefined;
    status: DebugSessionStatus;
    lastFrameId: number | undefined;
}

export class DebuggerTrackerLocal {
    // Events: There is an event generated whenever the status changes. There is also
    // a generic 'any' event. They all use the same arg of type ITrackedDebugSessionXfer
    // There is an additional event used internally for read/write capability detection
    public static eventEmitter = new events.EventEmitter();

    private static allSessionsById: { [sessionId: string]: ITrackedDebugSession } = {};
    private static allSessionsByConfigName: { [configName: string]: ITrackedDebugSession } = {};
    constructor(public session: vscode.DebugSession, status: DebugSessionStatus) {
        if (TrackedDebuggers.includes(session.type)) {
            const props: ITrackedDebugSession = {
                session: session,
                canWriteMemory: undefined,
                canReadMemory: undefined,
                status: status,
                lastFrameId: undefined
            };
            DebuggerTrackerLocal.allSessionsById[session.id] = props;
            DebuggerTrackerLocal.allSessionsByConfigName[session.name] = props;
            DebuggerTrackerLocal.setStatus(session, status);
        }
    }

    public static getCurrentSessionsSerializable(): ITrackedDebugSessionXfer[] {
        const ret: ITrackedDebugSessionXfer[] = [];
        for (const [_key, value] of Object.entries(DebuggerTrackerLocal.allSessionsById)) {
            if (value.canReadMemory) {
                ret.push(DebuggerTrackerLocal.toSerilazable(value));
            }
        }
        return ret;
    }

    public static toSerilazable(value: ITrackedDebugSession): ITrackedDebugSessionXfer {
        const tmp: ITrackedDebugSessionXfer = {
            sessionId: value.session.id,
            sessionName: value.session.name,
            sessionType: value.session.type,
            wsFolder: value.session.workspaceFolder?.uri.toString() || '.',
            canWriteMemory: !!value.canWriteMemory,
            canReadMemory: !!value.canReadMemory,
            status: value.status
        };
        return tmp;
    }

    public static isValidSessionForMemory(id: string): string | boolean {
        const session = DebuggerTrackerLocal.allSessionsById[id];
        if (!session) {
            return 'No session with the session id ' + id +
                '. Probably a bug or a debugger type that we are not tracking';
        }
        if (!session.canReadMemory) {
            return 'The current debugger does provide a memory read API';
        }
        return true;
    }

    public static getSessionById(id: string): ITrackedDebugSession {
        return DebuggerTrackerLocal.allSessionsById[id];
    }

    public deleteSelf() {
        DebuggerTrackerLocal.setStatus(this.session, DebugSessionStatus.Terminated);
        delete DebuggerTrackerLocal.allSessionsById[this.session.id];
    }

    public static setStatus(s: vscode.DebugSession, status: DebugSessionStatus, frameId?: number) {
        // console.log(`Debug Tracker: Session '${s.name}': Status ${status}, id = ${s.id}`);
        const props = DebuggerTrackerLocal.allSessionsById[s.id];
        if (props && (props.status !== status)) {
            props.status = status;
            const arg = DebuggerTrackerLocal.toSerilazable(props);
            if (typeof frameId === 'number') {
                arg.frameId = frameId;
            }

            props.lastFrameId = frameId;
            DebuggerTrackerLocal.eventEmitter.emit(status, arg);
            DebuggerTrackerLocal.eventEmitter.emit('any', arg);
        }
    }

    public static setCapabilities(s: vscode.DebugSession, capabilities: DebugProtocol.Capabilities): boolean {
        const props = DebuggerTrackerLocal.allSessionsById[s.id];
        props.canReadMemory = !!capabilities?.supportsReadMemoryRequest;
        props.canWriteMemory = !!capabilities?.supportsWriteMemoryRequest;
        DebuggerTrackerLocal.eventEmitter.emit('capabilities', props);
        return props.canReadMemory;
    }
}

export class DebugTrackerFactory {
    static context: vscode.ExtensionContext;
    public static register(cxt: vscode.ExtensionContext): DebugTrackerFactory {
        DebugTrackerFactory.context = cxt;
        return new DebugTrackerFactory();
    }
    constructor() {
        DebugTrackerFactory.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(this.settingsChanged.bind(this))
        );
        this.updateTrackedDebuggersFromSettings(false);
        this.subscribeToTracker();
    }

    public isActive() {
        return !!trackerApiClientInfo;
    }

    private settingsChanged(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration('memory-view.trackDebuggers')) {
            this.updateTrackedDebuggersFromSettings(true);
        }
    }

    private updateTrackedDebuggersFromSettings(prompt: boolean) {
        const config = vscode.workspace.getConfiguration('memory-view', null);
        const prop = config.get('trackDebuggers', []);
        if (prop && Array.isArray(prop)) {
            for (let ix = 0; ix < prop.length; ix++) {
                if (!TrackedDebuggers.includes(prop[ix])) {
                    TrackedDebuggers.push(prop[ix]);
                    // TODO: add debugger to the subscription dynamically. For now, we just notify user
                    if (prompt) {
                        vscode.window.showInformationMessage('Settings changed for tracked debuggers. You have to Reload this window for this to take effect');
                        prompt = false;
                    }
                }
            }
        }
    }

    private subscribeToTracker(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            DebugTracker.getTrackerExtension('MemoryView').then((ret) => {
                if (ret instanceof Error) {
                    vscode.window.showErrorMessage(ret.message);
                    resolve(false);
                } else {
                    trackerApi = ret;
                    const arg: IDebuggerTrackerSubscribeArg = {
                        version: 1,
                        body: {
                            debuggers: TrackedDebuggers,
                            handler: DebugTrackerFactory.debugTrackerEventHandler,	// Only this debugger
                            wantCurrentStatus: true,
                            notifyAllEvents: false,
                            // Make sure you set debugLevel to zero for production
                            debugLevel: 0
                        }
                    };
                    const result = trackerApi.subscribe(arg);
                    if (typeof result === 'string') {
                        vscode.window.showErrorMessage(`Subscription failed with extension 'debug-tracker-vscode' : ${result}`);
                        resolve(false);
                    } else {
                        trackerApiClientInfo = result;
                        resolve(true);
                    }
                }
            });
        });
    }

    static allTrackers: { [id: string]: DebuggerTrackerLocal } = {};
    static async debugTrackerEventHandler(event: IDebuggerTrackerEvent) {
        let tracker: DebuggerTrackerLocal | undefined;
        if (event.event === DebugSessionStatus.Initializing) {
            if (event.session) {
                tracker = new DebuggerTrackerLocal(event.session, DebugSessionStatus.Initializing);
                DebugTrackerFactory.allTrackers[event.sessionId] = tracker;
            }
            return;
        }

        if (event.session && !DebugTrackerFactory.allTrackers[event.sessionId]) {
            // Session was already in progress when we became alive
            tracker = new DebuggerTrackerLocal(event.session, event.event as DebugSessionStatus);
            DebugTrackerFactory.allTrackers[event.sessionId] = tracker;
            return;
        }

        tracker = DebugTrackerFactory.allTrackers[event.sessionId];
        if (!tracker) {
            // We are no longer tracking this (perhaps because can't read memory)
            return;
        }
        const session = tracker?.session as vscode.DebugSession;
        switch (event.event) {
            case DebugSessionStatus.Started: {
                DebuggerTrackerLocal.setStatus(session, DebugSessionStatus.Started);
                break;
            }
            case DebugSessionStatus.Stopped: {
                // We now rely on getting a stacktrace because some other client made such a request instead of doing one
                // ourselves. We could wait for 100ms and if we don't get a stackTrace event then we could issue our own request
                break;
            }
            case OtherDebugEvents.FirstStackTrace: {
                const frameId = event.stackTrace && event.stackTrace.body.stackFrames && event.stackTrace.body.stackFrames[0].id || undefined;
                DebuggerTrackerLocal.setStatus(session, DebugSessionStatus.Stopped, frameId);
                break;
            }
            case DebugSessionStatus.Running: {
                DebuggerTrackerLocal.setStatus(session, DebugSessionStatus.Running);
                break;
            }
            case OtherDebugEvents.Capabilities: {
                const good = DebuggerTrackerLocal.setCapabilities(session, event.capabilities as DebugProtocol.Capabilities);
                if (!good) {
                    tracker.deleteSelf();
                    delete DebugTrackerFactory.allTrackers[event.sessionId];
                }
                break;
            }
            case DebugSessionStatus.Terminated: {
                tracker.deleteSelf();
                delete DebugTrackerFactory.allTrackers[event.sessionId];
                break;
            }
        }
    }
}

/*
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
function appendMsgToTmpDir(str: string) {
    try {
        // eslint-disable-next-line no-constant-condition
        if (false) {
            const fname = path.join(os.tmpdir(), 'memory-view-dbg-trace.txt');
            // console.log(`Write ${str} to file ${fname}`);
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
*/
