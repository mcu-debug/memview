// declare const acquireVsCodeApi: any;

declare function acquireVsCodeApi(): IVsCodeApi;
window.addEventListener('message', vscodeReceiveMessage);

import {
    atom,
    RecoilState,
} from 'recoil';

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
    bytes: Buffer;
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


export enum CmdType {
    GetMemory = 'GetMemory',
}

export interface ICmdBase {
    type: CmdType;
    id: number;
}

interface MsgResponse {
    request: ICmdBase;
    resolve: (arg: any) => void;
    resonse?: any;
}

type CommandHandler = (event: any) => void;
const commandHanders: { [command: string]: CommandHandler[] } = {};
const pendingRequests: { [id: number]: MsgResponse } = {};

export function vscodePostCommandMessage(msg: ICmdBase): Promise<any> {
    return new Promise((resolve) => {
        pendingRequests[msg.id] = { request: msg, resolve: resolve };
        myGlobals.vscode.postMessage({ type: 'command', body: msg });
    });
}

function vscodeReceiveMessage(event: any) {
    const data = event.data;
    if (data.type === 'response') {
        const id = data.id;
        if (typeof id === 'number') {
            const pending = pendingRequests[id];
            if (pending) {
                if (pending.resolve) {
                    pending.resolve(data.body);
                }
                delete pendingRequests[id];
            } else {
                console.error(`No pending response for comand with id ${id}`, data);
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
