/*
 * This file is a shared file between the webview and the main extension. There should
 * not be any webview or VSCode specific things in here. It should be all generic
 * node/typescript
 *
 * However, because we use some vscode Webview APIs (indirectly), it can bring in
 * the vscode post functions that are only valid in the Webview
 */

import { vscodePostCommandNoResponse } from './webview-globals';
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
    DebugSessionSatus as DebugSessionStatus
} from './shared';

export interface IPageEventArg {
    address: bigint;
}

export const DummyByte: IMemValue = { cur: -1, orig: -1, stale: true, inRange: false };
export class DualViewDoc {
    // DO NOT CHANGE PageSize w/o adjusting getPageEventId to make sure we don't create too
    // many event listeners to an address change SubPageSize so that we result in less than 10
    // listeners per SubPageSize
    public static readonly PageSize = 512;
    public static readonly SubPageSize = 64;

    // The idea is that each row subscribes to an event when that row changes, Each row
    // should subscribe to their row-base-address to see if something changed using un/setPageEventId()
    public eventEmitter = new events.EventEmitter();
    public static currentDoc: DualViewDoc | undefined;
    public static currentDocStack: string[] = [];
    public static allDocuments: { [key: string]: DualViewDoc } = {};
    private static memoryIF: IMemoryInterfaceCommands;
    public static init(arg: IMemoryInterfaceCommands) {
        DualViewDoc.memoryIF = arg;
    }

    public readonly baseAddress;
    private modifiedMap: Map<bigint, number> = new Map<bigint, number>();
    public readonly startAddress: bigint;
    public currentAddress: bigint;
    public readonly maxAddress: bigint;
    public displayName: string;
    public isReadonly: boolean;
    public sessionId: string;
    public readonly sessionName: string;
    public readonly wsFolder: string;

    // This part is serialized/deserialized on demand
    private memory: MemPages;
    public isReady = false;

    constructor(info: IWebviewDocXfer) {
        this.startAddress = BigInt(info.startAddress);
        this.currentAddress = info.currentAddress ? BigInt(info.currentAddress) : this.startAddress;
        this.baseAddress = (this.startAddress / 16n) * 16n;
        this.maxAddress = this.startAddress + BigInt(info.maxBytes || 1024 * 1024);
        this.displayName = info.displayName;
        this.wsFolder = info.wsFolder;
        this.sessionId = info.sessionId;
        this.sessionName = info.sessionName;
        this.isReadonly = info.isReadOnly;
        if (info.modifiedMap) {
            // This map can contain values are are not actually yet in our memory
            for (const [key, value] of Object.entries(info.modifiedMap)) {
                this.modifiedMap.set(BigInt(key), value);
            }
        }
        this.memory = new MemPages(this.baseAddress, this);
        DualViewDoc.addDocument(this, !!info.isCurrentDoc);
    }

    async getMemoryPage(addr: bigint, nBytes: number): Promise<Uint8Array> {
        let ary = this.memory.getPageIfFresh(addr);
        if (ary) {
            return Promise.resolve(ary);
        }
        ary = undefined;
        try {
            ary = await this.getMemoryPageFromSource(addr, nBytes);
        } catch (e) {}
        if (!ary) {
            ary = new Uint8Array(0);
        } else if (ary.length > 0) {
            this.memory.setPage(addr, ary);
        }
        return ary;
    }

    public static debuggerStatusChanged(
        sessionId: string,
        status: DebugSessionStatus,
        sessionName: string,
        wsFolder: string
    ) {
        const retired = [];
        for (const [id, doc] of Object.entries(DualViewDoc.allDocuments)) {
            if (id !== sessionId) {
                if (
                    status === 'started' &&
                    sessionName === doc.sessionName &&
                    doc.wsFolder === wsFolder
                ) {
                    // We found an orphaned document and a new debug session started that can now own it
                    retired.push(id);
                    doc.sessionId = sessionId;
                    DualViewDoc.allDocuments[sessionId] = doc;
                }
            } else {
                doc.isReady = status === 'stopped';
                doc.memory.markAllStale();
            }
        }
        for (const id of retired) {
            // These ID's are now retired
            delete DualViewDoc.allDocuments[id];
        }
    }

    public static initializeAllDocuments(documents: IWebviewDocXfer[]) {
        for (const item of documents) {
            const xferObj = item as IWebviewDocXfer;
            const doc = new DualViewDoc(xferObj);
            doc.isReady = true;
        }
        if (Object.entries(DualViewDoc.allDocuments).length === 0) {
            DualViewDoc.createDummyDoc();
        }
        if (!DualViewDoc.currentDoc) {
            const [_key, doc] = Object.entries(DualViewDoc.allDocuments)[0];
            DualViewDoc.setCurrentDoc(doc);
        }
    }

    private static pendingRequests: { [key: string]: Promise<Uint8Array> } = {};
    getMemoryPageFromSource(addr: bigint, nBytes: number): Promise<Uint8Array> {
        const msg: ICmdGetMemory = {
            type: CmdType.GetMemory,
            sessionId: this.sessionId,
            seq: 0,
            addr: addr.toString(),
            count: nBytes
        };
        const key = msg.addr + this.sessionId;
        const oldPromise = DualViewDoc.pendingRequests[key];
        if (oldPromise) {
            return oldPromise;
        }
        const promise = DualViewDoc.memoryIF.getMemory(msg);
        DualViewDoc.pendingRequests[key] = promise;
        return promise;
    }
    removeFromPendingRequests(addr: bigint) {
        const key = addr.toString() + this.sessionId;
        delete DualViewDoc.pendingRequests[key];
    }

    addrInRange(addr: bigint): boolean {
        return addr >= this.startAddress && addr <= this.maxAddress;
    }

    static getDocumentById(id: string) {
        return DualViewDoc.allDocuments[id];
    }

    static async getCurrentDocByte(addr: bigint): Promise<IMemValue> {
        const doc = DualViewDoc.currentDoc;
        if (doc && doc.addrInRange(addr)) {
            const o = await doc.memory.getValue(addr, !doc.isReady);
            const orig = o === undefined ? -1 : o;
            const v = doc.modifiedMap.get(addr);
            const ret: IMemValue = {
                cur: v === undefined ? orig : v,
                orig: orig,
                stale: doc.memory.isStale(addr),
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
            const orig = doc.memory.getRowSync(addr);
            const ret: IMemValue[] = [];
            const isStale = doc.memory.isStale(addr);
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
        const id: string =
            typeof docOrId === 'string' ? (docOrId as string) : (docOrId as DualViewDoc).sessionId;
        const doc = DualViewDoc.allDocuments[id];
        if (doc) {
            if (DualViewDoc.currentDoc) {
                DualViewDoc.currentDocStack.push(DualViewDoc.currentDoc.sessionId);
            }
            DualViewDoc.currentDoc = doc;
        }
    }

    static getDocumentsList(): IWebviewDocInfo[] {
        const ret: IWebviewDocInfo[] = [];
        for (const key of Object.getOwnPropertyNames(DualViewDoc.allDocuments)) {
            const doc = DualViewDoc.allDocuments[key];
            const tmp: IWebviewDocInfo = {
                displayName: doc.displayName,
                sessionId: doc.sessionId,
                isModified: doc.isModified(),
                isCurrent: doc === DualViewDoc.currentDoc
            };
            ret.push(tmp);
        }
        return ret;
    }

    static setPageEventId(addr: bigint, cb: (arg: IPageEventArg) => void) {
        const doc = DualViewDoc.currentDoc;
        if (doc) {
            const eventId = doc.memory.getPageEventId(addr);
            doc.eventEmitter.addListener(eventId, cb);
        }
    }

    static unsetPageEventId(addr: bigint, cb: (arg: IPageEventArg) => void) {
        const doc = DualViewDoc.currentDoc;
        if (doc) {
            const eventId = doc.memory.getPageEventId(addr);
            doc.eventEmitter.removeListener(eventId, cb);
        }
    }

    isModified(): boolean {
        return !isEmpty(this.modifiedMap);
    }

    getSerializable(): IWebviewDocXfer {
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
            isReadOnly: this.isReadonly
        };
        return tmp;
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
    private pages: IMemPage[] = [];
    constructor(private baseAddress: bigint, private parentDoc: DualViewDoc) {}

    createDummyPage(str: string) {
        const tmp: IMemPage = {
            stale: false,
            buffer: new Uint8Array(Buffer.from(str))
        };
        this.pages.push(tmp);
    }

    private getSlot(addr: bigint): number {
        const slot = Math.floor(Number(addr - this.baseAddress) / DualViewDoc.PageSize);
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

    setPage(addr: bigint, ary: Uint8Array) {
        const slot = this.getSlot(addr);
        this.growPages(slot);
        const old = this.pages[slot].buffer;
        const eventId = this.getPageEventId(addr);
        for (let ix = 0; ix < ary.length && ix < old.length; ix += 16) {
            for (let iy = 0; iy < 16; iy++) {
                const index = ix + iy;
                if (index >= ary.length || index >= old.length) {
                    break;
                }
                if (old[index] != old[index]) {
                    this.parentDoc.eventEmitter.emit(eventId, {
                        address: addr + BigInt(index)
                    });
                    break;
                }
            }
        }
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
        const offset = Number(addr - BigInt(slot * DualViewDoc.PageSize));
        const buf = page ? page.buffer : undefined;
        return buf && offset < buf.length ? buf[offset] : -1;
    }

    public getRowSync(addr: bigint): number[] {
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        let offset = Number(addr - BigInt(slot * DualViewDoc.PageSize));
        const buf = page ? page.buffer : undefined;
        const ret: number[] = [];
        for (let ix = 0; ix < 16; ix++, offset++) {
            ret.push(buf && offset < buf.length ? buf[offset] : -1);
        }
        return ret;
    }

    public getValue(addr: bigint, forceOld: boolean): number | Promise<number> {
        const slot = this.getSlot(addr);
        let page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const get = () => {
            const offset = Number(addr - BigInt(slot * DualViewDoc.PageSize));
            const buf = page ? page.buffer : undefined;
            return buf && offset < buf.length ? buf[offset] : -1;
        };
        if (forceOld) {
            return get();
        }
        if (!page || page.stale || !page.buffer.length) {
            const blockAddr = this.baseAddress + BigInt(slot * DualViewDoc.PageSize);
            return new Promise((resolve) => {
                this.parentDoc
                    .getMemoryPageFromSource(blockAddr, DualViewDoc.PageSize)
                    .then((buf) => {
                        this.growPages(slot);
                        page = this.pages[slot];
                        if (page?.stale) {
                            page = {
                                stale: false,
                                buffer: buf
                            };
                            this.pages[slot] = page;
                        }
                        resolve(get());
                    })
                    .catch((e) => {
                        console.error('getMemory Failed', e);
                        resolve(-1);
                    })
                    .finally(() => {
                        this.parentDoc.removeFromPendingRequests(blockAddr);
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
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - BigInt(slot * DualViewDoc.PageSize));
        if (!page || offset >= page.buffer.length) {
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
}
