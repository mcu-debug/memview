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
    DebugSessionStatus,
    ICmdClientState,
    ICmdGetStartAddress,
    UnknownDocId,
    EndianType,
    RowFormatType
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
    docId: string;
    sessionId?: string;
}

export const DummyByte: IMemValue = { cur: -1, orig: -1, stale: true, inRange: false };
export class DualViewDoc {
    // DO NOT CHANGE PageSize w/o adjusting getPageEventId to make sure we don't create too
    // many event listeners to an address change SubPageSize so that we result in less than 10
    // listeners per SubPageSize
    public static readonly PageSize = 512;
    public static readonly SubPageSize = 64;

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
    public endian: EndianType;
    public format: RowFormatType;
    public isReadonly: boolean;
    public readonly docId: string;
    public sessionId: string;
    public sessionName: string;
    public wsFolder: string;
    public readonly inWebview: boolean;
    private clientState: { [key: string]: any };
    public sessionStatus: DocDebuggerStatus = DocDebuggerStatus.Default;
    private startAddressStale = true;

    // This part is serialized/deserialized on demand
    private memory: MemPages;
    public isReady = false;

    constructor(info: IWebviewDocXfer) {
        this.docId = info.docId;
        this.setAddresses(BigInt(info.startAddress));
        this.displayName = info.displayName;
        this.expr = info.expr;
        this.endian = info.endian ?? 'little';
        this.format = info.format ?? '1-byte';
        this.wsFolder = info.wsFolder;
        this.sessionId = info.sessionId;
        this.sessionName = info.sessionName;
        this.isReadonly = info.isReadOnly;
        this.inWebview = DualViewDoc.InWebview();
        this.startAddressStale = info.baseAddressStale;
        if (info.modifiedMap) {
            // This map can contain values are are not actually yet in our memory
            for (const [key, value] of Object.entries(info.modifiedMap)) {
                this.modifiedMap.set(BigInt(key), value);
            }
        }
        this.memory = info.memory
            ? MemPages.restoreSerializable(info.memory, this)
            : new MemPages(this);
        this.clientState = info.clientState;
        DualViewDoc.addDocument(this, !!info.isCurrentDoc);
    }

    static InWebview() {
        return !!myGlobals.vscode;
    }

    setAddresses(startAddress: bigint) {
        this.startAddress = startAddress;
        this.baseAddress = (this.startAddress / 16n) * 16n;
        this.maxAddress = this.baseAddress + BigInt(1024 * 1024);
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
                this.setAddresses(newVal);
                this.memory.markAllStale();
                this.emitGlobalEvent(DualViewDocGlobalEventType.BaseAddress);
            }
        } catch {}
        this.startAddressStale = false;
        return Promise.resolve(this.startAddress);
    }

    async getMemoryPage(addr: bigint, nBytes: number): Promise<Uint8Array> {
        let ary =
            !this.inWebview && !this.isReady
                ? this.memory.getPage(addr)
                : this.memory.getPageIfFresh(addr);
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

    public static debuggerStatusChanged(
        sessionId: string,
        status: DebugSessionStatus,
        sessionName: string,
        wsFolder: string
    ) {
        for (const [_id, doc] of Object.entries(DualViewDoc.allDocuments)) {
            const oldStatus = doc.sessionStatus;
            if (doc.sessionId !== sessionId) {
                if (
                    (status === 'started' || status === 'stopped') &&
                    (sessionName === doc.sessionName || !doc.sessionName) &&
                    (doc.wsFolder === wsFolder || !doc.wsFolder)
                ) {
                    // We found an orphaned document and a new debug session started that can now own it
                    console.log(
                        `New debug session ${sessionId} replaces ${doc.sessionId} inWebview = ${doc.inWebview}`
                    );
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
            } else {
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
            if (doc === DualViewDoc.currentDoc && oldStatus !== doc.sessionStatus) {
                doc.emitGlobalEvent(DualViewDocGlobalEventType.DebuggerStatus);
            }
        }
    }

    public markAsStale() {
        this.startAddressStale = true;
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

    static getDocumentById(id: string) {
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
        if (doc && doc.addrInRange(addr)) {
            const origRow = doc.memory.getRowSync(addr);
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
            for (let ix = 0; ix < 16; ix++) {
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
        const id: string =
            typeof docOrId === 'string' ? (docOrId as string) : (docOrId as DualViewDoc).docId;
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
    private emitGlobalEvent(type: DualViewDocGlobalEventType) {
        if (!this.inWebview || this !== DualViewDoc.currentDoc) {
            return;
        }

        // Not sure why but we have to debounce the event changes. Or React states
        // don't update properly. It seems not use the latest change if it sees a
        // a -> b -> a as not a state change if it happens too rapidly. May also
        // save flickering if we debounce.
        if (this.statusChangeTimeout) {
            clearTimeout(this.statusChangeTimeout);
        }
        this.statusChangeTimeout = setTimeout(() => {
            this.statusChangeTimeout = undefined;
            const arg: IDualViewDocGlobalEventArg = {
                type: type,
                docId: this.docId,
                sessionId: this.sessionId,
                sessionStatus: this.sessionStatus,
                baseAddress: this.baseAddress
            };
            DualViewDoc.globalEventEmitter.emit(arg.type, arg);
            DualViewDoc.globalEventEmitter.emit('any', arg);
        }, 100); // Is this enough delay?!?!?
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
            wsFolder: this.wsFolder,
            startAddress: this.startAddress.toString(),
            maxBytes: Number(this.maxAddress - this.startAddress),
            isCurrentDoc: this === DualViewDoc.currentDoc,
            modifiedMap: newMap,
            clientState: this.clientState,
            baseAddressStale: this.startAddressStale,
            isReadOnly: this.isReadonly
        };
        if (includeMemories) {
            tmp.memory = this.memory.storeSerializable();
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
        if (
            DualViewDoc.InWebview() &&
            Object.getOwnPropertyNames(DualViewDoc.allDocuments).length === 0
        ) {
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
            maxBytes: initString.length,
            isCurrentDoc: true,
            clientState: {},
            baseAddressStale: true,
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

    createDummyPage(str: string) {
        const tmp: IMemPage = {
            stale: false,
            current: new Uint8Array(Buffer.from(str))
        };
        this.pages.push(tmp);
    }

    private getSlot(addr: bigint): number {
        const offset = addr - this.baseAddress;
        const slot = Math.floor(Number(offset) / DualViewDoc.PageSize);
        return slot;
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
        const subSlot = Math.floor(Number(addr - this.baseAddress) / DualViewDoc.SubPageSize);
        const ret = `address-${slot}-${subSlot}`;
        return ret;
    }

    getPageIfFresh(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot < this.pages.length && !this.pages[slot].stale
            ? this.pages[slot].current
            : undefined;
    }

    getPage(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot < this.pages.length ? this.pages[slot].current : undefined;
    }

    setPage(addr: bigint, ary: Uint8Array, dbgCaller = 'MemPages.getValue') {
        // eslint-disable-next-line no-constant-condition
        if (true) {
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
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
        const offset = Number(addr - pageAddr);
        const buf = page ? page.current : undefined;
        return buf && offset < buf.length ? buf[offset] : -1;
    }

    public getRowSync(addr: bigint): IByteVal[] {
        addr = (addr / 16n) * 16n;
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
        let offset = Number(addr - pageAddr);
        const buf = page?.current;
        const pBuf = page?.previous;
        const ret: IByteVal[] = [];
        for (let ix = 0; ix < 16; ix++, offset++) {
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
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
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
                this.parentDoc
                    .getMemoryPageFromSource(pageAddr, DualViewDoc.PageSize)
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
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - pageAddr);
        if (!page || offset < 0 || offset >= page.current.length) {
            if (useThrow) {
                const maxAddr = this.baseAddress + BigInt(this.pages.length * DualViewDoc.PageSize);
                throw new Error(
                    `Requested address ${addr}. base address = ${this.baseAddress}, max address = ${maxAddr}`
                );
            }
        } else {
            const buf = this.pages[slot].current;
            buf[offset] = val;
        }
    }

    storeSerializable() {
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
        console.log(ret.pages);
        return ret;
    }
}

export interface IMemPages {
    baseAddress: string;
    pages: number[][];
}
