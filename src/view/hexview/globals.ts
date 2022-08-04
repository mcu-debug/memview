declare const acquireVsCodeApi: any;

export interface IMyGlobals {
    vscode: any
    bytes: Uint8Array | undefined
}
export const myGlobals: IMyGlobals  = {
    vscode: acquireVsCodeApi(),
    bytes: undefined
};
