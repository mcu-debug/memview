import { IMemPages } from './dual-view-doc';


export enum CmdType {
    GetDocuments = 'GetDocuments',
    GetMemory = 'GetMemory',
    SetByte = 'GetMemory',
    DebugerStatus = 'DebuggerStatus',
    GetDebuggerSessions = 'DebuggerSessions',
    NewDocument = 'NewDocument',
    SaveClientState = 'SaveClientState',
    GetStartAddress = 'GetBaseAddress'
}

export interface IMessage {
    type: 'response' | 'command' | 'notice';
    seq: number;
    command: CmdType;
    body: any;
}

export interface ICmdBase {
    type: CmdType;
    seq?: number; // Must be filled in before sending
    sessionId: string; // Leave empty where session does not matter
}

export interface ICmdGetDocuments extends ICmdBase {
    documents: IWebviewDocXfer[];
}

export interface MsgResponse {
    request: ICmdBase;
    resolve: (arg: any) => void;
    resonse?: any;
}

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
export interface ICmdGetMemory extends ICmdBase {
    addr: string;
    count: number;
}

export interface ICmdGetBaseAddress extends ICmdBase {
    expr: string;
    def: string;
}

export interface ICmdSetMemory extends ICmdGetMemory {
    bytes: Uint8Array;
}

export interface ICmdSetByte extends ICmdBase {
    addr: string;
    value: number; // Positive number is new value, neg is deletion
}

export interface IMemValue {
    cur: number;
    orig: number;
    stale: boolean;
    inRange: boolean;
}

export interface IWebviewDocInfo {
    displayName: string;
    sessionId: string;
    sessionStatus: string;
    isModified: boolean;
    isCurrent: boolean;
}
export type ModifiedXferMap = { [addr: string]: number };
export interface IWebviewDocXfer {
    sessionId: string; // The debug session ID, also the document Id
    sessionName: string;
    displayName: string;
    wsFolder: string;
    startAddress: string;
    isReadOnly: boolean; // Where to start reading.
    currentAddress?: string; // When displayed, what address should be visible
    isCurrentDoc?: boolean;
    maxBytes?: number;
    modifiedMap?: ModifiedXferMap;
    memory?: IMemPages;
    baseAddressStale: boolean;
    clientState: { [key: string]: any };
}

export interface ICmdClientState extends ICmdBase {
    state: { [key: string]: any };
}

export interface IMemoryInterfaceCommands {
    getStartAddress(arg: ICmdGetBaseAddress): Promise<string>;
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array>;
    setMemory(arg: ICmdSetMemory): Promise<boolean>;
}

export type DebugSessionStatus = 'started' | 'running' | 'stopped' | 'terminated' | 'unknown';

export interface ITrackedDebugSessionXfer {
    sessionId: string;
    sessionName: string;
    sessionType: string;
    wsFolder: string;
    canWriteMemory: boolean;
    canReadMemory: boolean;
    status: DebugSessionStatus;
    frameId?: number;
}
