/* eslint-disable no-debugger */
/*
 * This file is a shared file between the webview and the main extension. There should
 * not be any webview or VSCode specific things in here. It should be all generic
 * node/typescript
 *
 * However, because we use some vscode Webview APIs (indirectly), it can bring in
 * the vscode post functions that are only valid in the Webview
 */

import { myGlobals, vscodePostCommandNoResponse } from './webview-globals';
import { Buffer } from 'buffer';
import events from 'events';
import {
    IMemValue,
    IMemoryInterfaceCommands,
    IWebviewDocXfer,
    ICmdGetMemory,
    CmdType,
    ICmdSetByte,
    IWebviewDocInfo,
    ModifiedXferMap,
    DebugSessionStatusSimple,
    ICmdClientState,
    ICmdGetStartAddress,
    ICmdGetMaxBytes,
    UnknownDocId,
    EndianType,
    RowFormatType,
    IModifiableProps
} from './shared';
import { hexFmt64 } from './utils';

export enum DualViewDocGlobalEventType {
    CurrentDoc = 'current-doc',
    DebuggerStatus = 'debugger-status',
    BaseAddress = 'base-address'
}

export enum DocDebuggerStatus {
    Default = 'No debugger attached',
    Busy = 'Debugger attached, busy',
    Stopped = 'Debugger attached, stopped'
}

interface IByteVal {
    previous: number;
    current: number;
}
export interface IDualViewDocGlobalEventArg {
    type: DualViewDocGlobalEventType;
    sessionStatus?: DocDebuggerStatus;
    baseAddress: bigint;
    maxBytes: bigint;
    docId: string;
    sessionId?: string;
}

export const DummyByte: IMemValue = { cur: -1, orig: -1, stale: true, inRange: false };
export class DualViewDoc {
    public static globalEventEmitter = new events.EventEmitter();
    public static currentDoc: DualViewDoc | undefined;
    public static currentDocStack: string[] = [];
    public static allDocuments: { [key: string]: DualViewDoc } = {};
    private static memoryIF: IMemoryInterfaceCommands;
    public static init(arg: IMemoryInterfaceCommands) {
        DualViewDoc.memoryIF = arg;
        DualViewDoc.globalEventEmitter.setMaxListeners(1000);
    }

    public baseAddress = 0n;
    private modifiedMap: Map<bigint, number> = new Map<bigint, number>();
    public startAddress = 0n;
    public maxAddress = 0n;
    public displayName: string;
    public expr: string;
    public size: string;
    public endian: EndianType;
    public format: RowFormatType;
    public column: string;
    public bytesPerRow: number;
    public maxBytes = 4n * 1024n * 1024n;
    public isReadonly: boolean;
    public readonly docId: string;
    public sessionId: string;
    public sessionName: string;
    public wsFolder: string;
    public readonly inWebview: boolean;
    private clientState: { [key: string]: any };
    public sessionStatus: DocDebuggerStatus = DocDebuggerStatus.Default;
    private startAddressStale = true;
    private maxBytesStale = true;

    // DO NOT CHANGE PageSize w/o adjusting getPageEventId to make sure we don't create too
    // many event listeners to an address change SubPageSize so that we result in less than 10
    // listeners per SubPageSize
    public PageSize: number;
    public SubPageSize: number;

    // This part is serialized/deserialized on demand
    private memory: MemPages;
    public isReady = false;

    constructor(info: IWebviewDocXfer) {
        this.docId = info.docId;
        this.setAddresses(BigInt(info.startAddress), BigInt(info.maxBytes));
        this.displayName = info.displayName;
        this.expr = info.expr;
        this.size = info.size;
        this.endian = info.endian ?? 'little';
        this.format = info.format ?? '1-byte';
        this.column = info.column ?? '16';
        this.bytesPerRow = this.getBytesPerCell(this.format) * Number(this.column),
        this.wsFolder = info.wsFolder;
        this.sessionId = info.sessionId;
        this.sessionName = info.sessionName;
        this.isReadonly = info.isReadOnly;
        this.inWebview = DualViewDoc.InWebview();
        this.startAddressStale = info.baseAddressStale;
        this.maxBytesStale = info.maxBytesStale;
        this.PageSize = 16 * this.bytesPerRow;
        this.SubPageSize = this.PageSize / 8;
        if (info.modifiedMap) {
            // This map can contain values are are not actually yet in our memory
            for (const [key, value] of Object.entries(info.modifiedMap)) {
                this.modifiedMap.set(BigInt(key), value);
            }
        }
        this.memory = info.memory ? MemPages.restoreSerializable(info.memory, this) : new MemPages(this);
        // console.log(info.clientState);
        this.clientState = info.clientState || {};
        DualViewDoc.addDocument(this, !!info.isCurrentDoc);
    }

    /**
     *
     * @param info
     * @returns false is no existing doc matches, true if the current doc matches. Returns the doc object if
     * the current doc needs to be changed to an existing doc
     */
    public static findDocumentIfExists(info: IWebviewDocXfer): undefined | DualViewDoc {
        if (this.InWebview()) {
            return undefined; // Not allowed in a webview
        }
        for (const doc of Object.values(DualViewDoc.allDocuments)) {
            if (info.expr !== doc.expr) {
                continue;
            }
            if (info.sessionName && info.sessionName !== doc.sessionName) {
                continue;
            }
            if (info.wsFolder && info.wsFolder !== doc.wsFolder) {
                continue;
            }
            return doc;
        }
        return undefined;
    }

    static InWebview() {
        return !!myGlobals.vscode;
    }

    getBytesPerCell(format : RowFormatType): 1 | 2 | 4 | 8 {
        switch (format) {
            case '1-byte': {
                return 1;
                break;
            }
            case '2-byte': {
                return 2;
                break;
            }
            case '4-byte': {
                return 4;
                break;
            }
            case '8-byte': {
                return 8;
                break;
            }
            default: {
                console.error('Invalid format');
                return 1;
                break;
            }
        }
    }

    setAddresses(startAddress: bigint, maxBytes: bigint) {
        this.startAddress = startAddress;
        this.maxBytes = maxBytes;
        this.baseAddress = this.startAddress;
        this.maxAddress = this.baseAddress + this.maxBytes;
    }

    updateSettings(settings: IModifiableProps) {
        if ((this.expr !== settings.expr) || (this.size !== settings.size)) {
            this.expr = settings.expr;
            this.size = settings.size;
            this.markAsStale();
        }
        this.displayName = settings.displayName;
        this.endian = settings.endian;
        this.format = settings.format;
        this.column = settings.column;
        this.bytesPerRow = this.getBytesPerCell(this.format) * Number(this.column);
        this.PageSize = 16 * this.bytesPerRow;
        this.SubPageSize = this.PageSize / 8;
        // Now everything is out of sync. Requires a total re-render it is the callers responsibility to do that
    }

    async setClientState<T>(key: string, value: T) {
        this.clientState[key] = value;
        if (this.inWebview) {
            const cmd: ICmdClientState = {
                state: this.clientState,
                type: CmdType.SaveClientState,
                sessionId: this.sessionId,
                docId: this.docId
            };
            await vscodePostCommandNoResponse(cmd);
        }
    }

    getClientState<T>(key: string, def: T): T {
        const v = this.clientState[key];
        return v === undefined ? def : v;
    }

    setClientStateAll(state: { [key: string]: any }) {
        // Only used in VSCode
        this.clientState = state;
    }

    async getStartAddress(): Promise<bigint> {
        if (!this.startAddressStale) {
            return Promise.resolve(this.startAddress);
        }
        if (this.sessionStatus !== DocDebuggerStatus.Stopped) {
            return Promise.resolve(this.startAddress);
        }
        const arg: ICmdGetStartAddress = {
            expr: this.expr,
            def: this.startAddress.toString(),
            type: CmdType.GetStartAddress,
            sessionId: this.sessionId,
            docId: this.docId
        };
        try {
            const str = await DualViewDoc.memoryIF.getStartAddress(arg);
            const newVal = BigInt(str);
            if (newVal != this.startAddress) {
                this.setAddresses(newVal, this.maxBytes);
                this.memory.markAllStale();
                this.emitGlobalEvent(DualViewDocGlobalEventType.BaseAddress);
            }
        } catch {}
        this.startAddressStale = false;
        return Promise.resolve(this.startAddress);
    }

    async getMaxBytes(): Promise<bigint> {
        if (!this.maxBytesStale) {
            return Promise.resolve(this.maxBytes);
        }
        if (this.sessionStatus !== DocDebuggerStatus.Stopped) {
            return Promise.resolve(this.maxBytes);
        }
        const arg: ICmdGetMaxBytes = {
            expr: this.size,
            def: this.maxBytes.toString(),
            type: CmdType.GetMaxBytes,
            sessionId: this.sessionId,
            docId: this.docId
        };
        try {
            const str = await DualViewDoc.memoryIF.getMaxBytes(arg);
            const newVal = BigInt(str);
            if (newVal != this.maxBytes) {
                this.setAddresses(this.startAddress, newVal);
                this.memory.markAllStale();
                this.emitGlobalEvent(DualViewDocGlobalEventType.BaseAddress);
            }
        } catch {}
        this.maxBytesStale = false;
        return Promise.resolve(this.maxBytes);
    }

    async getMemoryPage(addr: bigint, nBytes: number): Promise<Uint8Array> {
        let ary = !this.inWebview && !this.isReady ? this.memory.getPage(addr) : this.memory.getPageIfFresh(addr);
        if (ary) {
            return Promise.resolve(ary);
        }
        ary = undefined;
        try {
            ary = await this.getMemoryPageFromSource(addr, nBytes);
        } catch (e) {}
        if (!ary) {
            ary = new Uint8Array(0); // TODO: This should not happen
        } else if (ary.length > 0) {
            this.memory.setPage(addr, ary);
        }
        return Promise.resolve(ary);
    }

    public getMemoryRaw(): MemPages {
        return this.memory;
    }

    public refreshMemoryIfStale(): Promise<any> {
        return this.memory.refreshMemoryIfStale();
    }

    public static debuggerStatusChanged(
        sessionId: string,
        status: DebugSessionStatusSimple,
        sessionName: string,
        wsFolder: string
    ) {
        const debug = false;
        debug && console.log(sessionId, status, sessionName, wsFolder);
        for (const [_id, doc] of Object.entries(DualViewDoc.allDocuments)) {
            const oldStatus = doc.sessionStatus;
            if (doc.sessionId !== sessionId) {
                if (
                    (status === 'started' || status === 'stopped') &&
                    (sessionName === doc.sessionName || !doc.sessionName) &&
                    (doc.wsFolder === wsFolder || !doc.wsFolder)
                ) {
                    // We found an orphaned document and a new debug session started that can now own it
                    debug &&
                        console.log(`New debug session ${sessionId} => ${doc.sessionId} webview = ${doc.inWebview}`);
                    doc.sessionId = sessionId;
                    doc.sessionName = sessionName;
                    doc.wsFolder = wsFolder;
                    doc.sessionStatus = DocDebuggerStatus.Busy;
                    doc.memory.deleteHistory();
                    if (status === 'stopped') {
                        doc.markAsStale();
                        doc.sessionStatus = DocDebuggerStatus.Stopped;
                    }
                }
            } else if (status !== 'initializing') {
                doc.isReady = status === 'stopped';
                if (status === 'stopped') {
                    doc.markAsStale();
                    doc.sessionStatus = DocDebuggerStatus.Stopped;
                } else if (status === 'terminated') {
                    doc.sessionStatus = DocDebuggerStatus.Default;
                    doc.memory.deleteHistory();
                } else {
                    doc.sessionStatus = DocDebuggerStatus.Busy;
                }
            }
            debug && console.log('old vs new status', oldStatus, doc.sessionStatus);
            if (doc === DualViewDoc.currentDoc && oldStatus !== doc.sessionStatus) {
                debug && console.log('emitting event on debugger status', doc.sessionStatus);
                doc.emitGlobalEvent(DualViewDocGlobalEventType.DebuggerStatus);
            }
        }
    }

    public markAsStale() {
        this.startAddressStale = true;
        this.maxBytesStale = true;
        this.memory.markAllStale();
    }

    public static markAllDocsStale() {
        for (const [_id, doc] of Object.entries(DualViewDoc.allDocuments)) {
            doc.markAsStale();
        }
    }

    private pendingRequests: { [key: number]: Promise<Uint8Array> } = {};
    getMemoryPageFromSource(addr: bigint, nBytes: number): Promise<Uint8Array> {
        const msg: ICmdGetMemory = {
            type: CmdType.GetMemory,
            sessionId: this.sessionId,
            docId: this.docId,
            seq: 0,
            addr: addr.toString(),
            count: nBytes
        };
        const key = Number(addr - this.baseAddress);
        const pendingPromise = this.pendingRequests[key];
        if (pendingPromise) {
            return pendingPromise;
        }
        // eslint-disable-next-line no-async-promise-executor
        const promise = new Promise<Uint8Array>(async (resolve) => {
            try {
                if (this.startAddressStale) {
                    await this.getStartAddress();
                }
                if (this.maxBytesStale) {
                    await this.getMaxBytes();
                }
                const ret = await DualViewDoc.memoryIF.getMemory(msg);
                resolve(ret);
            } catch (e) {
                console.error('Error getting memory address or value', e);
                resolve(new Uint8Array(0));
            }
            delete this.pendingRequests[key];
        });
        this.pendingRequests[key] = promise;
        return promise;
    }

    addrInRange(addr: bigint): boolean {
        return addr >= this.baseAddress && addr <= this.maxAddress;
    }

    static getDocumentById(id: string): DualViewDoc | undefined {
        return DualViewDoc.allDocuments[id];
    }

    private static first = true;
    static async getCurrentDocByte(addr: bigint): Promise<IMemValue> {
        const doc = DualViewDoc.currentDoc;
        if (doc && doc.addrInRange(addr)) {
            const orig = await doc.memory.getValue(addr);
            if (this.first && orig.current < 0) {
                this.first = false;
                // debugger;
            }
            const v = doc.modifiedMap.get(addr);
            const modified = v === undefined ? orig.current : v;
            const ret: IMemValue = {
                cur: modified,
                orig: orig.current,
                stale: doc.memory.isStale(addr),
                changed: orig.current !== orig.previous || modified !== orig.current,
                inRange: true
            };
            return ret;
        } else {
            return DummyByte;
        }
    }

    static getRowUnsafe(addr: bigint): IMemValue[] {
        const doc = DualViewDoc.currentDoc;
        const bytesPerRow = doc?.bytesPerRow || 16;
        if (doc && doc.addrInRange(addr)) {
            const origRow = doc.memory.getRowSync(addr, BigInt(bytesPerRow));
            const isStale = doc.memory.isStale(addr);
            const ret: IMemValue[] = [];
            for (const orig of origRow) {
                const v = doc.modifiedMap.get(addr);
                const modified = v === undefined ? orig.current : v;
                const tmp: IMemValue = {
                    cur: modified,
                    orig: orig.current,
                    stale: isStale,
                    changed: orig.current !== orig.previous || modified !== orig.current,
                    inRange: orig.current >= 0
                };
                ret.push(tmp);
                addr++;
            }
            return ret;
        } else {
            const ret: IMemValue[] = [];
            for (let ix = 0; ix < bytesPerRow; ix++) {
                ret.push(DummyByte);
            }
            return ret;
        }
    }

    // Only for webviews. Will fail on VSCode side -- use setByteLocal() instead
    static setCurrentDocByte(addr: bigint, val: number) {
        const doc = DualViewDoc.currentDoc;
        if (doc) {
            const old = doc.setByteLocal(addr, val);
            const cmd: ICmdSetByte = {
                addr: addr.toString(),
                value: old === val ? -1 : val,
                type: CmdType.SetByte,
                sessionId: doc.sessionId,
                docId: doc.docId
            };
            vscodePostCommandNoResponse(cmd);
        }
    }

    setByteLocal(addr: bigint, val: number): number {
        const old = this.memory.getValueSync(addr);
        if (old === val) {
            this.modifiedMap.delete(addr);
        } else {
            this.modifiedMap.set(addr, val);
        }
        return old;
    }

    // This is only called from within VSCode and not from the WebView
    private static addDocument(doc: DualViewDoc, makeCurrent = false) {
        DualViewDoc.allDocuments[doc.docId] = doc;
        if (makeCurrent) {
            DualViewDoc.setCurrentDoc(doc);
        }
    }

    // This is only called from within VSCode and not from the WebView
    static removeDocument(docOrId: DualViewDoc | string) {
        const id = (docOrId as string) || (docOrId as DualViewDoc).docId;
        const doc = DualViewDoc.allDocuments[id];
        if (doc === DualViewDoc.currentDoc) {
            const values = Object.getOwnPropertyNames(DualViewDoc.allDocuments);
            let pos = values.findIndex((v) => v === doc.docId);
            DualViewDoc.currentDoc = undefined;
            while (DualViewDoc.currentDocStack.length) {
                const oldId = DualViewDoc.currentDocStack.pop();
                if (oldId && DualViewDoc.allDocuments[oldId]) {
                    DualViewDoc.setCurrentDoc(oldId);
                    break;
                }
            }
            if (!DualViewDoc.currentDoc) {
                values.splice(pos, 1);
                if (values.length > 0) {
                    pos = pos % values.length;
                    DualViewDoc.setCurrentDoc(values[pos]);
                }
            }
        }
        delete DualViewDoc.allDocuments[id];
    }

    // This is only called from within VSCode and not from the WebView
    static setCurrentDoc(docOrId: DualViewDoc | string) {
        const oldId = DualViewDoc.currentDoc?.docId;
        const id: string = typeof docOrId === 'string' ? (docOrId as string) : (docOrId as DualViewDoc).docId;
        const doc = DualViewDoc.allDocuments[id];
        if (doc) {
            if (DualViewDoc.currentDoc) {
                DualViewDoc.currentDocStack.push(DualViewDoc.currentDoc.docId);
            }
            DualViewDoc.currentDoc = doc;
        }
        if (doc && oldId !== doc?.docId) {
            // Don't think the following is needed
            doc.emitGlobalEvent(DualViewDocGlobalEventType.CurrentDoc);
        }
    }

    private statusChangeTimeout: NodeJS.Timeout | undefined;
    private pendingArg: IDualViewDocGlobalEventArg | undefined;
    private emitGlobalEvent(type: DualViewDocGlobalEventType) {
        const debug = false;
        if (!this.inWebview) {
            debug && console.log('emitGlobalEvent early return because not in webview');
            return;
        }
        if (this !== DualViewDoc.currentDoc) {
            debug && console.log('emitGlobalEvent early return because not current doc');
            return;
        }

        // Not sure why but we have to debounce the event changes. Or React states
        // don't update properly. It seems not use the latest change if it sees a
        // a -> b -> a as not a state change if it happens too rapidly. May also
        // save flickering if we debounce.
        if (this.statusChangeTimeout) {
            debug && console.log('emitGlobalEvent Canceling event', this.pendingArg);
            clearTimeout(this.statusChangeTimeout);
        }
        const arg: IDualViewDocGlobalEventArg = {
            type: type,
            docId: this.docId,
            sessionId: this.sessionId,
            sessionStatus: this.sessionStatus,
            baseAddress: this.baseAddress,
            maxBytes: this.maxBytes
        };
        this.pendingArg = arg;
        this.statusChangeTimeout = setTimeout(() => {
            this.statusChangeTimeout = undefined;
            debug && console.log('emitGlobalEvent Emitting event', arg);
            DualViewDoc.globalEventEmitter.emit(arg.type, arg);
            DualViewDoc.globalEventEmitter.emit('any', arg);
        }, 1); // Is this enough delay?!?!? If the delay is too much, we miss status changes totally.
        // We should try to remove the debounce stuff completely
    }

    static getBasicDocumentsList(): IWebviewDocInfo[] {
        const ret: IWebviewDocInfo[] = [];
        for (const key of Object.getOwnPropertyNames(DualViewDoc.allDocuments)) {
            const doc = DualViewDoc.allDocuments[key];
            const tmp: IWebviewDocInfo = {
                displayName: doc.displayName,
                sessionId: doc.sessionId,
                docId: doc.docId,
                sessionStatus: doc.sessionStatus,
                baseAddress: doc.baseAddress,
                startAddress: doc.startAddress,
                maxBytes: doc.maxBytes,
                isModified: doc.isModified(),
                isCurrent: doc === DualViewDoc.currentDoc
            };
            ret.push(tmp);
        }
        return ret;
    }

    isModified(): boolean {
        return !isEmpty(this.modifiedMap);
    }

    getSerializable(includeMemories = false): IWebviewDocXfer {
        const newMap: ModifiedXferMap = {};
        this.modifiedMap.forEach((value, key) => {
            newMap[key.toString()] = value;
        });
        const tmp: IWebviewDocXfer = {
            docId: this.docId,
            sessionId: this.sessionId,
            sessionName: this.sessionName,
            displayName: this.displayName,
            expr: this.expr,
            endian: this.endian,
            format: this.format,
            column: this.column,
            size: this.size,
            wsFolder: this.wsFolder,
            startAddress: this.startAddress.toString(),
            maxBytes: this.maxBytes.toString(),
            isCurrentDoc: this === DualViewDoc.currentDoc,
            modifiedMap: newMap,
            clientState: this.clientState,
            baseAddressStale: this.startAddressStale,
            maxBytesStale: this.maxBytesStale,
            isReadOnly: this.isReadonly
        };
        if (includeMemories) {
            tmp.memory = this.memory.getSerializablePages();
        }
        return tmp;
    }

    public static storeSerializableAll(includeMemories = false): IWebviewDocXfer[] {
        const docs = [];
        for (const [_key, value] of Object.entries(DualViewDoc.allDocuments)) {
            const doc = value.getSerializable(includeMemories);
            docs.push(doc);
        }
        return docs;
    }

    public static restoreSerializableAll(documents: IWebviewDocXfer[]) {
        DualViewDoc.currentDoc = undefined;
        DualViewDoc.allDocuments = {};
        let lastDoc = undefined;
        for (const item of documents) {
            const xferObj = item as IWebviewDocXfer;
            const doc = new DualViewDoc(xferObj);
            doc.isReady = false;
            lastDoc = doc;
        }
        if (DualViewDoc.InWebview() && Object.getOwnPropertyNames(DualViewDoc.allDocuments).length === 0) {
            lastDoc = DualViewDoc.createDummyDoc();
        }
        if (!DualViewDoc.currentDoc && lastDoc) {
            DualViewDoc.setCurrentDoc(lastDoc);
        }
    }

    private static createDummyDoc(): DualViewDoc {
        const initString =
            'Add a new view  ' +
            'using the plus  ' +
            'button in the   ' +
            'Toolbar with the' +
            'debugger paused ' +
            'Supported       ' +
            'debuggers: cspy,' +
            'cortex-debug,   ' +
            'cppdbg';
        const tmp: IWebviewDocXfer = {
            docId: UnknownDocId,
            sessionId: UnknownDocId,
            sessionName: UnknownDocId,
            expr: UnknownDocId,
            displayName: 'No memory views',
            wsFolder: '.',
            startAddress: '0',
            endian: 'little',
            format: '1-byte',
            column: '16',
            size: '4 * 1024 * 1024',
            maxBytes: initString.length.toString(),
            isCurrentDoc: true,
            clientState: {},
            baseAddressStale: true,
            maxBytesStale: true,
            isReadOnly: true
        };
        const doc = new DualViewDoc(tmp);
        doc.memory.createDummyPage(initString /*.replace(/ /g, '-')*/);
        return doc;
    }
}

function isEmpty(obj: any) {
    for (const prop in obj) {
        // eslint-disable-next-line no-prototype-builtins
        if (obj.hasOwnProperty(prop)) return false;
    }

    return true;
}

interface IMemPage {
    stale: boolean;
    current: Uint8Array;
    previous?: Uint8Array | undefined;
}
class MemPages {
    constructor(private parentDoc: DualViewDoc, private pages: IMemPage[] = []) {}

    get baseAddress(): bigint {
        return this.parentDoc.baseAddress;
    }

    get maxAddress(): bigint {
        return this.parentDoc.maxAddress;
    }

    public numPages(): number {
        return this.pages.length;
    }

    createDummyPage(str: string) {
        const tmp: IMemPage = {
            stale: false,
            current: new Uint8Array(Buffer.from(str))
        };
        this.pages.push(tmp);
    }

    private getSlot(addr: bigint): number {
        const offset = addr - this.baseAddress;
        const slot = Math.floor(Number(offset) / (DualViewDoc.currentDoc?.PageSize || 512));
        return slot;
    }

    public refreshMemoryIfStale(): Promise<any> {
        const promises = [];
        let addr = this.baseAddress;
        for (const page of this.pages) {
            if (page.stale) {
                promises.push(this.getValue(addr));
            }
            addr += BigInt(DualViewDoc.currentDoc?.PageSize || 512);
        }
        return Promise.all(promises);
    }

    public markAllStale() {
        for (const page of this.pages) {
            page.stale = true;
        }
    }

    public deleteHistory() {
        for (const page of this.pages) {
            delete page.previous;
        }
    }

    public getPageEventId(addr: bigint): string {
        const slot = this.getSlot(addr);
        const subSlot = Math.floor(Number(addr - this.baseAddress) / (DualViewDoc.currentDoc?.SubPageSize || 64));
        const ret = `address-${slot}-${subSlot}`;
        return ret;
    }

    getPageIfFresh(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot < this.pages.length && !this.pages[slot].stale ? this.pages[slot].current : undefined;
    }

    getPage(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot < this.pages.length ? this.pages[slot].current : undefined;
    }

    setPage(addr: bigint, ary: Uint8Array, dbgCaller = 'MemPages.getValue') {
        // eslint-disable-next-line no-constant-condition
        if (false) {
            const addrStr = hexFmt64(addr);
            console.log(
                `${dbgCaller}, addr=${addrStr}, buf-length = ${ary.length}, Updating page, Webview = ${this.parentDoc.inWebview}`
            );
        }
        const slot = this.getSlot(addr);
        this.growPages(slot);
        const page = this.pages[slot];
        if (this.parentDoc.inWebview && page.stale && page.current.length) {
            page.previous = page.current;
        }
        page.current = ary;
        page.stale = false;
    }

    public isStale(addr: bigint): boolean {
        const slot = this.getSlot(addr);
        return slot < this.pages.length ? this.pages[slot].stale : true;
    }

    public getValueSync(addr: bigint): number {
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * (DualViewDoc.currentDoc?.PageSize || 512));
        const offset = Number(addr - pageAddr);
        const buf = page ? page.current : undefined;
        return buf && offset < buf.length ? buf[offset] : -1;
    }

    public getRowSync(addr: bigint, bytesPerRow: bigint): IByteVal[] {
        addr = this.baseAddress + (((addr - this.baseAddress) / bytesPerRow) * bytesPerRow);
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * (DualViewDoc.currentDoc?.PageSize || 512));
        let offset = Number(addr - pageAddr);
        const buf = page?.current;
        const pBuf = page?.previous;
        const ret: IByteVal[] = [];
        for (let ix = 0; ix < bytesPerRow; ix++, offset++) {
            const current = buf && offset < buf.length ? buf[offset] : -1;
            const previous = pBuf && offset < pBuf.length ? pBuf[offset] : current;
            ret.push({ current: current, previous: previous });
        }
        return ret;
    }

    private first = true;
    public getValue(addr: bigint): IByteVal | Promise<IByteVal> {
        const slot = this.getSlot(addr);
        let page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * (DualViewDoc.currentDoc?.PageSize || 512));
        const get = (): IByteVal => {
            const offset = Number(addr - pageAddr);
            const buf = page ? page.current : undefined;
            const current = buf && offset < buf.length ? buf[offset] : -1;
            let previous = current;
            if (this.first && current < 0) {
                this.first = false;
                // debugger;
            }
            if (page && page.previous && offset < page.previous.length) {
                previous = page.previous[offset];
            }
            const ret: IByteVal = {
                previous: previous,
                current: current
            };
            return ret;
        };
        if (!page || page.stale || !page.current.length) {
            this.growPages(slot);
            return new Promise((resolve) => {
                // Prevent load more than the input size
                this.parentDoc
                    .getMemoryPageFromSource(pageAddr, Math.min((DualViewDoc.currentDoc?.PageSize || 512), Number(this.maxAddress - addr)))
                    .then((buf) => {
                        page = this.pages[slot];
                        if (page.stale) {
                            this.setPage(pageAddr, buf);
                        }
                        resolve(get());
                    })
                    .catch((e) => {
                        console.error('getMemory Failed', e);
                        resolve({ current: -1, previous: -1 });
                    });
            });
        } else {
            return get();
        }
    }

    private growPages(slot: number) {
        for (let i = this.pages.length; i <= slot; i++) {
            const page: IMemPage = {
                stale: true,
                current: new Uint8Array(0)
            };
            this.pages.push(page);
        }
    }

    setValue(addr: bigint, val: number /* byte actually */, useThrow = false): void {
        const slot = this.getSlot(addr);
        const pageAddr = this.baseAddress + BigInt(slot * (DualViewDoc.currentDoc?.PageSize || 512));
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - pageAddr);
        if (!page || offset < 0 || offset >= page.current.length) {
            if (useThrow) {
                const maxAddr = this.baseAddress + BigInt(this.pages.length * (DualViewDoc.currentDoc?.PageSize || 512));
                throw new Error(
                    `Requested address ${addr}. base address = ${this.baseAddress}, max address = ${maxAddr}`
                );
            }
        } else {
            const buf = this.pages[slot].current;
            buf[offset] = val;
        }
    }

    public getSerializablePages(): IMemPages {
        const ret: IMemPages = {
            baseAddress: this.baseAddress.toString(),
            pages: this.pages.map((p) => {
                return Array.from(p.current);
            })
        };
        return ret;
    }

    static restoreSerializable(obj: IMemPages, parent: DualViewDoc): MemPages {
        const newPages: IMemPage[] = [];
        for (const page of obj.pages) {
            const newPage: IMemPage = {
                stale: true,
                current: new Uint8Array(page)
            };
            newPages.push(newPage);
        }
        const ret = new MemPages(parent, newPages);
        // console.log(ret.pages);
        return ret;
    }
}

export interface IMemPages {
    baseAddress: string;
    pages: number[][];
}
