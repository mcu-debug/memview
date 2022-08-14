import { CmdType, ICmdBase, vscodePostCommandMessage } from './globals';

export interface IWebViewXferData {
    startAddress: bigint;
    endAddress?: bigint;
}

interface ICmdGetMemory extends ICmdBase {
    addr: bigint;
    count: number;
}

export interface IMemValue {
    cur: number;
    orig: number;
}

export interface IWebviewDocInfo {
    displayName: string;
    id: string;
    isModified: boolean;
    isCurrent: boolean;
}

export class WebviewDoc {
    public static currentDoc: WebviewDoc | undefined;
    public static currentDocStack: string[] = [];
    private static allDocuments: { [key: string]: WebviewDoc } = {};
    public readonly baseAddress;
    private modified: Map<bigint, number> = new Map<bigint, number>;
    private memory: MemBuckets;

    constructor(public name: string, public readonly id: string, private bounds: IWebViewXferData) {
        this.baseAddress = (this.bounds.startAddress / 16n) * 16n;
        this.memory = new MemBuckets(this.baseAddress, this.getMoreMemory.bind(this));
    }

    getMoreMemory(addr: bigint, nBytes: number): Promise<Buffer> {
        const msg: ICmdGetMemory = {
            type: CmdType.GetMemory,
            id: 0,
            addr: addr,
            count: nBytes
        };
        return vscodePostCommandMessage(msg);
    }

    addrInRange(addr: bigint): boolean {
        if (addr < this.bounds.startAddress) { return false; }
        if (this.bounds.startAddress !== undefined) {
            if (addr >= (this.bounds.endAddress || 0)) { return false; }
        }
        return true;
    }

    static async getCurrentDocByte(addr: bigint): Promise<IMemValue> {
        const doc = WebviewDoc.currentDoc;
        if (doc && doc.addrInRange(addr)) {
            const o = await WebviewDoc.currentDoc?.memory.getValue(addr);
            const orig = (o === undefined) ? -1 : o;
            const v = doc.modified.get(addr);
            const ret: IMemValue = {
                cur: (v === undefined) ? orig : v,
                orig: orig
            };
            return ret;
        } else {
            return { cur: -1, orig: -1 };
        }
    }

    static setCurrentDocByte(addr: bigint, val: number): void {
        const doc = WebviewDoc.currentDoc;
        if (doc) {
            doc.modified.set(addr, val);
        }
    }

    static addDocument(doc: WebviewDoc, makeCurrent = false) {
        WebviewDoc.allDocuments[doc.id] = doc;
        if (makeCurrent) {
            WebviewDoc.setCurrentDoc(doc);
        }
    }
    static removeDocument(docOrId: WebviewDoc | string) {
        const id = docOrId as string || (docOrId as WebviewDoc).id;
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
        const id = docOrId as string || (docOrId as WebviewDoc).id;
        const doc = WebviewDoc.allDocuments[id];
        if (doc) {
            if (WebviewDoc.currentDoc) {
                WebviewDoc.currentDocStack.push(WebviewDoc.currentDoc.id);
            }
            WebviewDoc.currentDoc = doc;
        }
    }

    static getDocumentsList(): IWebviewDocInfo[] {
        const ret: IWebviewDocInfo[] = [];
        for (const key of Object.getOwnPropertyNames(WebviewDoc.allDocuments)) {
            const doc = WebviewDoc.allDocuments[key];
            const tmp: IWebviewDocInfo = {
                displayName: doc.name,
                id: doc.id,
                isModified: doc.isModified(),
                isCurrent: (doc === WebviewDoc.currentDoc)
            };
            ret.push(tmp);
        }
        return ret;
    }

    isModified(): boolean {
        return !isEmpty(this.modified);
    }
}

function isEmpty(obj: any) {
    for (const prop in obj) {
        // eslint-disable-next-line no-prototype-builtins
        if (obj.hasOwnProperty(prop))
            return false;
    }

    return true;
}

export class MemBuckets {
    public static readonly BucketSize = 512;
    private buffers: Buffer[] = [];
    constructor(private baseAddress: bigint, private getMoreBytes: (addr: bigint, nBytes: number) => Promise<Buffer>) {
    }

    public getValue(addr: bigint): number | Promise<number> {
        const slot = Number(addr - this.baseAddress) / MemBuckets.BucketSize;
        const get = () => {
            const offset = Number(addr - BigInt(slot * MemBuckets.BucketSize));
            const buf = this.buffers[slot];
            return (offset < buf.length) ? buf[offset] : -1;
        };
        if ((slot >= this.buffers.length) || !this.buffers[slot] || !this.buffers[slot].length) {
            return new Promise((resolve) => {
                const blockAddr = this.baseAddress + BigInt(slot * MemBuckets.BucketSize);
                this.getMoreBytes(blockAddr, MemBuckets.BucketSize).then((buf) => {
                    for (let i = this.buffers.length; i <= slot; i++) {
                        this.buffers.push(Buffer.alloc(0));
                    }
                    this.buffers[slot] = buf;
                    resolve(get());
                }).catch(() => {
                    resolve(-1);
                });
            });
        } else {
            return get();
        }
    }

    setValue(addr: bigint, val: number /* byte actually */, useThrow = false): void {
        const slot = Number(addr - this.baseAddress) / MemBuckets.BucketSize;
        const offset = Number(addr - BigInt(slot * MemBuckets.BucketSize));
        if ((slot >= this.buffers.length) || !this.buffers[slot] || (offset >= this.buffers[slot].length)) {
            if (useThrow) {
                const maxAddr = this.baseAddress + BigInt(this.buffers.length * MemBuckets.BucketSize);
                throw new Error(`Requested address ${addr}. base address = ${this.baseAddress}, max address = ${maxAddr}`);
            }
        } else {
            const buf = this.buffers[slot];
            buf[offset] = val;
        }
    }
}
