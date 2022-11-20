
declare function acquireVsCodeApi(): IVsCodeApi;

export function globalsInit() {
    window.addEventListener('message', vscodeReceiveMessage);
    myGlobals.vscode = acquireVsCodeApi();
    myGlobals.selContext = new SelContext();
}

import {
    atom,
    RecoilState,
} from 'recoil';
import { DualViewDoc } from './dual-view-doc';
import { MsgResponse, ICmdBase, IMessage, CmdType } from './shared';
import { WebviewDebugTracker } from './webview-debug-tracker';
import { SelContext } from './selection';

export interface IVsCodeApi {
    postMessage(msg: unknown): void;
    getState(): any;
    setState(value: any): void;
}

export interface IMyGlobals {
    vscode?: IVsCodeApi;
    selContext?: SelContext;
}

export const myGlobals: IMyGlobals = {
};

export const frozenState: RecoilState<boolean> = atom({
    key: 'frozenState', // unique ID (with respect to other atoms/selectors)
    default: false,      // default value (aka initial value)
});

export function vscodeGetState<T>(item: string): T | undefined {
    const state = myGlobals.vscode?.getState();
    if (state) {
        return state[item] as T;
    }
    return undefined;
}

export function vscodeSetState<T>(item: string, v: T): void {
    const state = { ...myGlobals.vscode?.getState() };
    state[item] = v;
    myGlobals.vscode?.setState(state);
}

type CommandHandler = (event: any) => void;
const commandHanders: { [command: string]: CommandHandler[] } = {};
const pendingRequests: { [id: number]: MsgResponse } = {};
let seqNumber = 0;

function getSeqNumber(): number {
    if (seqNumber > (1 << 30)) {
        seqNumber = 0;
    }
    return ++seqNumber;
}

export function vscodePostCommand(msg: ICmdBase): Promise<any> {
    return new Promise((resolve) => {
        msg.seq = getSeqNumber();
        pendingRequests[seqNumber] = { request: msg, resolve: resolve };
        myGlobals.vscode?.postMessage({ type: 'command', body: msg });
    });
}

export function vscodePostCommandNoResponse(msg: ICmdBase): void {
    msg.seq = getSeqNumber();
    myGlobals.vscode?.postMessage({ type: 'command', body: msg });
}

function vscodeReceiveMessage(event: any) {
    const data = event.data as IMessage;
    if (data.type === 'response') {
        recieveResponseFromVSCode(data);
    } else if (data.type === 'command') {
        if (typeof data.command === 'string') {
            const handlers = commandHanders[data.command];
            if (handlers) {
                for (let ix = 0; ix < handlers.length; ix++) {
                    handlers[ix](data.body);
                }
            } else {
                console.error(`No hanlders for command ${data.command}`, data);
            }
        } else {
            console.error(`unrecognized command ${data.command} for command`, data);
        }
    } else if (data.type === 'notice') {
        recieveNoticeFromVSCode(data);
    } else {
        console.error('unrecognized event type for "message" from vscode', data);
    }
}

function recieveResponseFromVSCode(response: IMessage) {
    const seq = response.seq;
    const pending = pendingRequests[seq];
    if (pending && pending.resolve) {
        switch (response.command) {
            // Some commands don't need any translation. Only deal with
            // those that need it
            case CmdType.GetDocuments: {
                DualViewDoc.restoreSerializableAll(response.body);
                pending.resolve(true);
                break;
            }
            case CmdType.GetDebuggerSessions: {
                WebviewDebugTracker.updateSessions(response.body);
                pending.resolve(true);
                break;
            }
            default: {
                pending.resolve(response.body);
                break;
            }
        }
    } else {
        console.error(`No pending response for comand with id ${seq}`, response);
    }
    delete pendingRequests[seq];
}

function recieveNoticeFromVSCode(notice: IMessage) {
    switch (notice.command) {
        case CmdType.DebugerStatus: {
            WebviewDebugTracker.updateSession(notice.body);
            break;
        }
        default: {
            console.error('Invalid notice', notice);
            break;
        }
    }
}

export function addMessageHandler(type: string, handler: CommandHandler) {
    const existing = commandHanders[type];
    if (!existing) {
        commandHanders[type] = [handler];
    } else {
        removeMessageHandler(type, handler);        // Remove if already in the list
        existing.push(handler);                     // Now add at the end
    }
}

export function removeMessageHandler(type: string, handler: CommandHandler) {
    const existing = commandHanders[type];
    if (existing) {
        const ix = existing.indexOf(handler);
        if (ix >= 0) {
            existing.splice(ix, 1);
        }
    }
}
