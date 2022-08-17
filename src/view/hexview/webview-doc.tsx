/*
 * This file is a shared file between the webview and the main extension. There should
 * not be any webview or VSCode specific things in here. It should be all generic
 * node/typescript
 *
 * However, because we use some vscode Webview APIs (indirectly), it can bring in
 * the vscode post functions that are only valid in the Webview
 */

import { vscodePostCommandNoResponse } from './webview-globals';

export enum CmdType {
    GetDocuments = 'GetDocuments',
    GetMemory = 'GetMemory',
    SetByte = 'GetMemory'
}

export interface IResponse {
    type: 'response' | 'command';
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
    isModified: boolean;
    isCurrent: boolean;
}

type ModifedXferMap = { [addr: string]: number };
export interface IWebviewDocXfer {
    sessionId: string; // The debug session ID, also the document Id
    displayName: string;
    startAddress: string;
    isReadOnly: boolean; // Where to start reading.
    currentAddress?: string; // When displayed, what address should be visible
    isCurrentDoc?: boolean;
    maxBytes?: number;
    modifiedMap?: ModifedXferMap;
}

export interface IMemoryInterfaceCommands {
    getMemory(arg: ICmdGetMemory): Promise<Uint8Array>;
    setMemory(arg: ICmdSetMemory): Promise<boolean>;
}

export const DummyByte: IMemValue = { cur: -1, orig: -1, stale: true, inRange: false };
export class WebviewDoc {
    public static currentDoc: WebviewDoc | undefined;
    public static currentDocStack: string[] = [];
    public static allDocuments: { [key: string]: WebviewDoc } = {};
    private static memoryIF: IMemoryInterfaceCommands;
    public static init(arg: IMemoryInterfaceCommands) {
        WebviewDoc.memoryIF = arg;
    }

    public readonly baseAddress;
    private modifiedMap: Map<bigint, number> = new Map<bigint, number>();
    public startAddress: bigint;
    public currentAddress: bigint;
    public maxAddress: bigint;
    public displayName: string;
    public isReadonly: boolean;
    public readonly sessionId: string;

    // This part is serialized/deserialized on demand
    private memory: MemPages;
    public isReady = false;

    constructor(info: IWebviewDocXfer) {
        this.startAddress = BigInt(info.startAddress);
        this.currentAddress = info.currentAddress ? BigInt(info.currentAddress) : this.startAddress;
        this.baseAddress = (this.startAddress / 16n) * 16n;
        this.maxAddress = this.startAddress + BigInt(info.maxBytes || 1024 * 1024);
        this.displayName = info.displayName;
        this.sessionId = info.sessionId;
        this.isReadonly = info.isReadOnly;
        if (info.modifiedMap) {
            // This map can contain values are are not actually yet in our memory
            for (const [key, value] of Object.entries(info.modifiedMap)) {
                this.modifiedMap.set(BigInt(key), value);
            }
        }
        if (info.isCurrentDoc) {
            WebviewDoc.setCurrentDoc(this);
        }

        this.memory = new MemPages(this.baseAddress, this);
    }

    private static pendingRequests: { [key: string]: Promise<Uint8Array> } = {};
    getMoreMemory(addr: bigint, nBytes: number): Promise<Uint8Array> {
        const msg: ICmdGetMemory = {
            type: CmdType.GetMemory,
            sessionId: this.sessionId,
            seq: 0,
            addr: addr.toString(),
            count: nBytes
        };
        const key = msg.addr + this.sessionId;
        const oldPromise = WebviewDoc.pendingRequests[key];
        if (oldPromise) {
            return oldPromise;
        }
        const promise = WebviewDoc.memoryIF.getMemory(msg);
        WebviewDoc.pendingRequests[key] = promise;
        return promise;
    }
    removeFromPendingRequests(addr: bigint) {
        const key = addr.toString() + this.sessionId;
        delete WebviewDoc.pendingRequests[key];
    }

    addrInRange(addr: bigint): boolean {
        return addr >= this.startAddress && addr <= this.maxAddress;
    }

    static getDocumentById(id: string) {
        return WebviewDoc.allDocuments[id];
    }

    static async getCurrentDocByte(addr: bigint): Promise<IMemValue> {
        const doc = WebviewDoc.currentDoc;
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

    // Only for webviews. Will fail on VSCode side -- use setByteLocal() instead
    static setCurrentDocByte(addr: bigint, val: number) {
        const doc = WebviewDoc.currentDoc;
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

    static addDocument(doc: WebviewDoc, makeCurrent = false) {
        WebviewDoc.allDocuments[doc.sessionId] = doc;
        if (makeCurrent) {
            WebviewDoc.setCurrentDoc(doc);
        }
    }

    static removeDocument(docOrId: WebviewDoc | string) {
        const id = (docOrId as string) || (docOrId as WebviewDoc).sessionId;
        const doc = WebviewDoc.allDocuments[id];
        if (doc === WebviewDoc.currentDoc) {
            WebviewDoc.currentDoc = undefined;
            while (WebviewDoc.currentDocStack.length) {
                const oldId = WebviewDoc.currentDocStack.pop();
                if (oldId && WebviewDoc.allDocuments[oldId]) {
                    WebviewDoc.currentDoc = WebviewDoc.allDocuments[oldId];
                    break;
                }
            }
        }
        delete WebviewDoc.allDocuments[id];
    }

    static setCurrentDoc(docOrId: WebviewDoc | string) {
        const id: string =
            typeof docOrId === 'string' ? (docOrId as string) : (docOrId as WebviewDoc).sessionId;
        const doc = WebviewDoc.allDocuments[id];
        if (doc) {
            if (WebviewDoc.currentDoc) {
                WebviewDoc.currentDocStack.push(WebviewDoc.currentDoc.sessionId);
            }
            WebviewDoc.currentDoc = doc;
        }
    }

    static getDocumentsList(): IWebviewDocInfo[] {
        const ret: IWebviewDocInfo[] = [];
        for (const key of Object.getOwnPropertyNames(WebviewDoc.allDocuments)) {
            const doc = WebviewDoc.allDocuments[key];
            const tmp: IWebviewDocInfo = {
                displayName: doc.displayName,
                sessionId: doc.sessionId,
                isModified: doc.isModified(),
                isCurrent: doc === WebviewDoc.currentDoc
            };
            ret.push(tmp);
        }
        return ret;
    }

    isModified(): boolean {
        return !isEmpty(this.modifiedMap);
    }

    getSerializable(): IWebviewDocXfer {
        const newMap: ModifedXferMap = {};
        this.modifiedMap.forEach((value, key) => {
            newMap[key.toString()] = value;
        });
        const tmp: IWebviewDocXfer = {
            sessionId: this.sessionId,
            displayName: this.displayName,
            startAddress: this.startAddress.toString(),
            currentAddress: this.currentAddress.toString(),
            maxBytes: Number(this.maxAddress - this.startAddress),
            isCurrentDoc: this === WebviewDoc.currentDoc,
            modifiedMap: newMap,
            isReadOnly: this.isReadonly
        };
        return tmp;
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
    public static readonly BucketSize = 512;
    private pages: IMemPage[] = [];
    constructor(private baseAddress: bigint, private parentDoc: WebviewDoc) {}

    private getSlot(addr: bigint): number {
        const slot = Math.floor(Number(addr - this.baseAddress) / MemPages.BucketSize);
        return slot;
    }

    public isStale(addr: bigint): boolean {
        const slot = this.getSlot(addr);
        return slot < this.pages.length ? this.pages[slot].stale : true;
    }

    public getValueSync(addr: bigint): number {
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - BigInt(slot * MemPages.BucketSize));
        const buf = page ? page.buffer : undefined;
        return buf && offset < buf.length ? buf[offset] : -1;
    }

    public getValue(addr: bigint, forceOld: boolean): number | Promise<number> {
        const slot = this.getSlot(addr);
        let page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const get = () => {
            const offset = Number(addr - BigInt(slot * MemPages.BucketSize));
            const buf = page ? page.buffer : undefined;
            return buf && offset < buf.length ? buf[offset] : -1;
        };
        if (forceOld) {
            return get();
        }
        if (!page || page.stale || !page.buffer.length) {
            const blockAddr = this.baseAddress + BigInt(slot * MemPages.BucketSize);
            return new Promise((resolve) => {
                this.parentDoc
                    .getMoreMemory(blockAddr, MemPages.BucketSize)
                    .then((buf) => {
                        for (let i = this.pages.length; i <= slot; i++) {
                            page = {
                                stale: true,
                                buffer: new Uint8Array(0)
                            };
                            this.pages.push(page);
                        }
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

    setValue(addr: bigint, val: number /* byte actually */, useThrow = false): void {
        const slot = this.getSlot(addr);
        const page: IMemPage | undefined = slot < this.pages.length ? this.pages[slot] : undefined;
        const offset = Number(addr - BigInt(slot * MemPages.BucketSize));
        if (!page || offset >= page.buffer.length) {
            if (useThrow) {
                const maxAddr = this.baseAddress + BigInt(this.pages.length * MemPages.BucketSize);
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
