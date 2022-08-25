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
    DebugSessionStatus as DebugSessionStatus,
    ICmdClientState,
    ICmdGetBaseAddress as ICmdGetStartAddress
} from './shared';
import { hexFmt64 } from './utils';

export enum DualViewDocGlobalEventType {
    CurrentDoc = 'current-doc',
    DebuggerStatus = 'debugger-status',
    BaseAddress = 'base-address'
}
export interface IDualViewDocGlobalEventArg {
    type: DualViewDocGlobalEventType;
    sessionId?: string;
    sessionStatus?: string;
    baseAddress: bigint;
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

    public baseAddress;
    private modifiedMap: Map<bigint, number> = new Map<bigint, number>();
    public startAddress: bigint;
    public currentAddress: bigint;
    public maxAddress: bigint;
    public displayName: string;
    public isReadonly: boolean;
    public sessionId: string;
    public readonly sessionName: string;
    public readonly wsFolder: string;
    public readonly inWebview: boolean;
    private clientState: { [key: string]: any };
    private static readonly defaultStatus = 'No debugger attached';
    public sessionStatus: string = DualViewDoc.defaultStatus;
    private baseAddressStale = true;

    // This part is serialized/deserialized on demand
    private memory: MemPages;
    public isReady = false;

    constructor(info: IWebviewDocXfer) {
        this.setAddresses(BigInt(info.startAddress));
        this.currentAddress = info.currentAddress ? BigInt(info.currentAddress) : this.baseAddress;
        this.displayName = info.displayName;
        this.wsFolder = info.wsFolder;
        this.sessionId = info.sessionId;
        this.sessionName = info.sessionName;
        this.isReadonly = info.isReadOnly;
        this.inWebview = !!myGlobals.vscode;
        this.baseAddressStale = info.baseAddressStale;
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
                sessionId: this.sessionId
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

    async getBaseAddress(): Promise<bigint> {
        if (!this.baseAddressStale) {
            return Promise.resolve(this.baseAddress);
        }
        const arg: ICmdGetStartAddress = {
            expr: this.displayName,
            def: this.baseAddress.toString(),
            type: CmdType.GetStartAddress,
            sessionId: this.sessionId
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
        this.baseAddressStale = false;
        return Promise.resolve(this.baseAddress);
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
        const retired = [];
        const busy = 'Debugger attached, busy';
        for (const [id, doc] of Object.entries(DualViewDoc.allDocuments)) {
            const oldStatus = doc.sessionStatus;
            if (id !== sessionId) {
                if (
                    status === 'started' &&
                    sessionName === doc.sessionName &&
                    doc.wsFolder === wsFolder
                ) {
                    // We found an orphaned document and a new debug session started that can now own it
                    retired.push(id);
                    console.log(
                        `New debug session ${sessionId} replaces ${doc.sessionId} inWebview = ${doc.inWebview}`
                    );
                    doc.sessionId = sessionId;
                    doc.sessionStatus = busy;
                    DualViewDoc.allDocuments[sessionId] = doc;
                }
            } else {
                doc.isReady = status === 'stopped';
                if (status === 'stopped') {
                    doc.baseAddressStale = true;
                    doc.memory.markAllStale();
                    doc.sessionStatus = 'Debugger attached, stopped';
                } else if (status === 'terminated') {
                    doc.sessionStatus = this.defaultStatus;
                } else {
                    doc.sessionStatus = busy;
                }
            }
            if (doc === DualViewDoc.currentDoc && oldStatus !== doc.sessionStatus) {
                doc.emitGlobalEvent(DualViewDocGlobalEventType.DebuggerStatus);
            }
        }
        for (const id of retired) {
            // These ID's are now retired
            delete DualViewDoc.allDocuments[id];
        }
    }

    private pendingRequests: { [key: number]: Promise<Uint8Array> } = {};
    getMemoryPageFromSource(addr: bigint, nBytes: number): Promise<Uint8Array> {
        const msg: ICmdGetMemory = {
            type: CmdType.GetMemory,
            sessionId: this.sessionId,
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
                if (this.baseAddressStale) {
                    await this.getBaseAddress();
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
            if (this.first && orig < 0) {
                this.first = false;
                debugger;
            }
            const v = doc.modifiedMap.get(addr);
            const ret: IMemValue = {
                cur: v === undefined ? orig : v,
                orig: orig,
                stale: doc.memory.isStale(addr),
                inRange: true
            };
            return ret;
        } else {
            debugger;
            return DummyByte;
        }
    }

    static getRowUnsafe(addr: bigint): IMemValue[] {
        const doc = DualViewDoc.currentDoc;
        if (doc && doc.addrInRange(addr)) {
            const orig = doc.memory.getRowSync(addr);
            const isStale = doc.memory.isStale(addr);
            const ret: IMemValue[] = [];
            for (const value of orig) {
                const v = doc.modifiedMap.get(addr);
                const tmp: IMemValue = {
                    cur: v === undefined ? value : v,
                    orig: value,
                    stale: isStale,
                    inRange: value >= 0
                };
                ret.push(tmp);
                addr++;
            }
            return ret;
        } else {
            const ret: IMemValue[] = [];
            for (let ix = 0; ix < 16; ix++) {
                debugger;
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
                sessionId: doc.sessionId
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

    private static addDocument(doc: DualViewDoc, makeCurrent = false) {
        DualViewDoc.allDocuments[doc.sessionId] = doc;
        if (makeCurrent) {
            DualViewDoc.setCurrentDoc(doc);
        }
    }

    static removeDocument(docOrId: DualViewDoc | string) {
        const id = (docOrId as string) || (docOrId as DualViewDoc).sessionId;
        const doc = DualViewDoc.allDocuments[id];
        if (doc === DualViewDoc.currentDoc) {
            DualViewDoc.currentDoc = undefined;
            while (DualViewDoc.currentDocStack.length) {
                const oldId = DualViewDoc.currentDocStack.pop();
                if (oldId && DualViewDoc.allDocuments[oldId]) {
                    DualViewDoc.currentDoc = DualViewDoc.allDocuments[oldId];
                    break;
                }
            }
        }
        delete DualViewDoc.allDocuments[id];
    }

    static setCurrentDoc(docOrId: DualViewDoc | string) {
        const oldId = DualViewDoc.currentDoc?.sessionId;
        const id: string =
            typeof docOrId === 'string' ? (docOrId as string) : (docOrId as DualViewDoc).sessionId;
        const doc = DualViewDoc.allDocuments[id];
        if (doc) {
            if (DualViewDoc.currentDoc) {
                DualViewDoc.currentDocStack.push(DualViewDoc.currentDoc.sessionId);
            }
            DualViewDoc.currentDoc = doc;
        }
        if (doc && oldId !== doc?.sessionId) {
            doc.emitGlobalEvent(DualViewDocGlobalEventType.CurrentDoc);
        }
    }

    private emitGlobalEvent(type: DualViewDocGlobalEventType) {
        const arg: IDualViewDocGlobalEventArg = {
            type: type,
            sessionId: this.sessionId,
            sessionStatus: this.sessionStatus,
            baseAddress: this.baseAddress
        };
        DualViewDoc.globalEventEmitter.emit(arg.type, arg);
        DualViewDoc.globalEventEmitter.emit('any', arg);
    }

    static getDocumentsList(): IWebviewDocInfo[] {
        const ret: IWebviewDocInfo[] = [];
        for (const key of Object.getOwnPropertyNames(DualViewDoc.allDocuments)) {
            const doc = DualViewDoc.allDocuments[key];
            const tmp: IWebviewDocInfo = {
                displayName: doc.displayName,
                sessionId: doc.sessionId,
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
            sessionId: this.sessionId,
            sessionName: this.sessionName,
            displayName: this.displayName,
            wsFolder: this.wsFolder,
            startAddress: this.startAddress.toString(),
            currentAddress: this.currentAddress.toString(),
            maxBytes: Number(this.maxAddress - this.startAddress),
            isCurrentDoc: this === DualViewDoc.currentDoc,
            modifiedMap: newMap,
            clientState: this.clientState,
            baseAddressStale: this.baseAddressStale,
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

    public static restoreSerializableAll(documents: IWebviewDocXfer[], createDummy: boolean) {
        let lastDoc = undefined;
        for (const item of documents) {
            const xferObj = item as IWebviewDocXfer;
            const doc = new DualViewDoc(xferObj);
            doc.isReady = false;
            lastDoc = doc;
        }
        if (createDummy && Object.entries(DualViewDoc.allDocuments).length === 0) {
            DualViewDoc.createDummyDoc();
        }
        if (!DualViewDoc.currentDoc && lastDoc) {
            DualViewDoc.setCurrentDoc(lastDoc);
        }
    }

    public static createDummyDoc() {
        const initString =
            'Please add a new view using the dropdown menu above when a C/C++ like debugger is active. ' +
            'We currently have support for cppdbg, cortex-debug, and cspy';
        const tmp: IWebviewDocXfer = {
            sessionId: 'Dummy',
            sessionName: 'Unknown',
            displayName: 'No memory view',
            wsFolder: '.',
            startAddress: '0',
            maxBytes: initString.length,
            isCurrentDoc: true,
            clientState: {},
            baseAddressStale: true,
            isReadOnly: true
        };
        const doc = new DualViewDoc(tmp);
        doc.memory.createDummyPage(initString.replace(/ /g, '.'));
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
    buffer: Uint8Array;
}
class MemPages {
    constructor(private parentDoc: DualViewDoc, private pages: IMemPage[] = []) {}

    get baseAddress(): bigint {
        return this.parentDoc.baseAddress;
    }

    createDummyPage(str: string) {
        const tmp: IMemPage = {
            stale: false,
            buffer: new Uint8Array(Buffer.from(str))
        };
        this.pages.push(tmp);
    }

    private getSlot(addr: bigint): number {
        const offset = addr - this.baseAddress;
        if (offset < 0 || offset > 1024 * 1024) {
            // eslint-disable-next-line no-debugger
            debugger;
        }
        const slot = Math.floor(Number(offset) / DualViewDoc.PageSize);
        return slot;
    }

    public markAllStale() {
        for (const page of this.pages) {
            page.stale = true;
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
            ? this.pages[slot].buffer
            : undefined;
    }

    getPage(addr: bigint): Uint8Array | undefined {
        const slot = this.getSlot(addr);
        return slot < this.pages.length ? this.pages[slot].buffer : undefined;
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
        this.pages[slot].buffer = ary;
        this.pages[slot].stale = false;
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
        const buf = page ? page.buffer : undefined;
        return buf && offset < buf.length ? buf[offset] : -1;
    }

    public getRowSync(addr: bigint): number[] {
        addr = (addr / 16n) * 16n;
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
        let offset = Number(addr - pageAddr);
        const buf = page ? page.buffer : undefined;
        const ret: number[] = [];
        for (let ix = 0; ix < 16; ix++, offset++) {
            ret.push(buf && offset < buf.length ? buf[offset] : -1);
        }
        return ret;
    }

    private first = true;
    public getValue(addr: bigint): number | Promise<number> {
        const slot = this.getSlot(addr);
        let page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
        const get = () => {
            const offset = Number(addr - pageAddr);
            const buf = page ? page.buffer : undefined;
            const ret = buf && offset < buf.length ? buf[offset] : -1;
            if (this.first && ret < 0) {
                this.first = false;
                debugger;
            }
            return ret;
        };
        if (!page || page.stale || !page.buffer.length) {
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
                        if (this.first) {
                            this.first = false;
                            debugger;
                        }
                        resolve(-1);
                    });
            });
        } else {
            return get();
        }
    }

    private growPages(slot: number) {
        for (let i = this.pages.length; i <= slot; i++) {
            const page = {
                stale: true,
                buffer: new Uint8Array(0)
            };
            this.pages.push(page);
        }
    }

    setValue(addr: bigint, val: number /* byte actually */, useThrow = false): void {
        const slot = this.getSlot(addr);
        const pageAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - pageAddr);
        if (!page || offset < 0 || offset >= page.buffer.length) {
            if (useThrow) {
                const maxAddr = this.baseAddress + BigInt(this.pages.length * DualViewDoc.PageSize);
                throw new Error(
                    `Requested address ${addr}. base address = ${this.baseAddress}, max address = ${maxAddr}`
                );
            }
        } else {
            const buf = this.pages[slot].buffer;
            buf[offset] = val;
        }
    }

    storeSerializable() {
        const ret: IMemPages = {
            baseAddress: this.baseAddress.toString(),
            pages: this.pages.map((p) => {
                return Array.from(p.buffer);
            })
        };
        return ret;
    }

    static restoreSerializable(obj: IMemPages, parent: DualViewDoc): MemPages {
        const newPages: IMemPage[] = [];
        for (const page of obj.pages) {
            const newPage: IMemPage = {
                stale: true,
                buffer: new Uint8Array(page)
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
