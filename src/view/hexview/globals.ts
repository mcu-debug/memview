// declare const acquireVsCodeApi: any;

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

export const myGlobals: IMyGlobals  = {
    vscode: acquireVsCodeApi(),
    bytes: undefined,
    isReadonly: true
};
