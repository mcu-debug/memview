import { IMemPages } from './dual-view-doc';

export const UnknownDocId = 'Unknown';

export enum CmdType {
    GetDocuments = 'GetDocuments',
    GetMemory = 'GetMemory',
    SetByte = 'GetMemory',
    DebugerStatus = 'DebuggerStatus',
    GetDebuggerSessions = 'DebuggerSessions',
    NewDocument = 'NewDocument',
    SaveClientState = 'SaveClientState',
    GetStartAddress = 'GetBaseAddress',
    ButtonClick = 'ButtonClick',
    SettingsChanged = 'SettingsChanged'
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
    docId: string;
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

export interface ICmdGetStartAddress extends ICmdBase {
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
    changed?: boolean;      // Changed on reload (different from edited)
    cur: number;
    orig: number;
    stale: boolean;
    inRange: boolean;
}

export type RowFormatType = '1-byte' | '2-byte' | '4-byte' | '8-byte';
export type EndianType = 'little' | 'big';

export interface IModifiableProps {
    expr: string;
    displayName: string;
    endian: EndianType;
    format: RowFormatType;
}
export interface IWebviewDocInfo {
    displayName: string;
    sessionId: string;
    docId: string;
    sessionStatus: string;
    isModified: boolean;
    isCurrent: boolean;
    baseAddress: bigint;
    startAddress: bigint;
}

export interface ICmdSettingsChanged extends ICmdBase {
    settings: IModifiableProps;
}

export type ModifiedXferMap = { [addr: string]: number };
export interface IWebviewDocXfer {
    docId: string;
    sessionId: string;          // The debug session ID, also the document Id
    sessionName: string;        // The debug session name
    displayName: string;
    expr: string;
    wsFolder: string;
    startAddress: string;
    isReadOnly: boolean; // Where to start reading.
    format: RowFormatType;
    endian: EndianType;
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

export type CmdButtonName = 'close' | 'new' | 'select' | 'refresh' | 'settings' | 'copy-all-to-clipboard' | 'copy-all-to-file';
export interface ICmdButtonClick extends ICmdBase {
    button: CmdButtonName;
}

export interface IMemoryInterfaceCommands {
    getStartAddress(arg: ICmdGetStartAddress): Promise<string>;
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array>;
    setMemory(arg: ICmdSetMemory): Promise<boolean>;
}

export type DebugSessionStatusSimple = 'initializing' | 'started' | 'running' | 'stopped' | 'terminated' | 'unknown';

export interface ITrackedDebugSessionXfer {
    sessionId: string;
    sessionName: string;
    sessionType: string;
    wsFolder: string;
    canWriteMemory: boolean;
    canReadMemory: boolean;
    status: DebugSessionStatusSimple;
    frameId?: number;
}
