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
    bytes: Uint8Array | undefined;
    isReadonly: boolean;
}

export const myGlobals: IMyGlobals = {
    vscode: acquireVsCodeApi(),
    bytes: undefined,
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
