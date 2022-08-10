// declare const acquireVsCodeApi: any;

import {
    RecoilRoot,
    atom,
    selector,
    useRecoilState,
    useRecoilValue,
    RecoilState,
} from 'recoil';

interface IVsCodeApi {
    postMessage(msg: unknown): void;
    getState(): any;
    setState(value: any): void;
}

declare function acquireVsCodeApi(): IVsCodeApi;

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
