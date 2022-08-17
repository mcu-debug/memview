
declare function acquireVsCodeApi(): IVsCodeApi;
window.addEventListener('message', vscodeReceiveMessage);

import {
    atom,
    RecoilState,
} from 'recoil';
import { MsgResponse, ICmdBase } from './webview-doc';

export interface IVsCodeApi {
    postMessage(msg: unknown): void;
    getState(): any;
    setState(value: any): void;
}

export interface IMyGlobals {
    vscode: IVsCodeApi;
    origBytes: Uint8Array;
    bytes: Uint8Array;
    // both min and max addresses are inclusive
    minAddress: bigint,
    maxAddress: bigint | undefined,
    isReadonly: boolean;
}

export const myGlobals: IMyGlobals = {
    vscode: acquireVsCodeApi(),
    origBytes: new Uint8Array(0),
    bytes: new Uint8Array(0),
    minAddress: 0n,
    maxAddress: undefined,
    isReadonly: false
};

export const frozenState: RecoilState<boolean> = atom({
    key: 'frozenState', // unique ID (with respect to other atoms/selectors)
    default: false,      // default value (aka initial value)
});

export interface IMemviewDocumentOptions {
    bytes: Uint8Array;
    uriString: string;
    fsPath: string;
    isReadonly?: boolean;
    memoryReference?: string;
    expression?: string;
    isFixedSize?: boolean;
    initialSize?: number;
}

export function vscodeGetState<T>(item: string): T | undefined {
    const state = myGlobals.vscode.getState();
    if (state) {
        return state[item] as T;
    }
    return undefined;
}

export function vscodeSetState<T>(item: string, v: T): void {
    const state = { ...myGlobals.vscode.getState() };
    state[item] = v;
    myGlobals.vscode.setState(state);
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
        myGlobals.vscode.postMessage({ type: 'command', body: msg });
    });
}

function vscodeReceiveMessage(event: any) {
    const data = event.data;
    console.log('vscodeReceiveMessage', data);
    if (data.type === 'response') {
        const seq = data.seq;
        if (typeof seq === 'number') {
            const pending = pendingRequests[seq];
            if (pending) {
                if (pending.resolve) {
                    const tmp = new Uint8Array(data.body.data);
                    pending.resolve(tmp);
                }
                delete pendingRequests[seq];
            } else {
                console.error(`No pending response for comand with id ${seq}`, data);
            }
        } else {
            console.error('No/invalid message id for', data);
        }
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
    } else {
        console.error('unrecognized event type for "message" from vscode', data);
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
