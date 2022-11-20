import { DualViewDoc } from './dual-view-doc';
import events from 'events';
import { HexCellValue, HexDataRow } from './hex-elements';

export class SelRange {
    constructor(readonly start: bigint, readonly end: bigint) {}
}
export class SelContext {
    public static current: SelContext | undefined;
    public static eventEmitter = new events.EventEmitter();
    private addrToRowNode = new Map<bigint, HexDataRow>();
    public range: SelRange | undefined;
    public current: bigint | undefined;
    constructor() {
        if (!SelContext.current) {
            document.addEventListener('copy', () => {
                SelContext.current?.copyToClipboard();
            });
        }
        SelContext.current = this;
        this.clear();
    }

    public static isSelected(addr: bigint): boolean {
        const range = SelContext.current?.range;
        if (range) {
            return addr >= range.start && addr <= range.end;
        }
        return false;
    }

    public static isSelectionInRow(addr: bigint): boolean {
        const range = SelContext.current?.range;
        const doc = DualViewDoc.currentDoc;
        if (range && doc) {
            const rSize = doc.format === '1-byte' ? 16n : 32n;
            addr = addr / rSize;
            return addr >= range.start / rSize && addr <= range.end / rSize;
        }
        return false;
    }

    public setCurrent(address: bigint, elt: Element) {
        const sel = document.getSelection();
        const doc = DualViewDoc.currentDoc;
        if (sel && doc) {
            sel.removeAllRanges();
            const range = document.createRange();
            range.selectNodeContents(elt);
            sel.addRange(range);
        }

        const prev = this.current ?? 0n;
        this.current = address; // New anchor
        if (!this.range) {
            this.range = new SelRange(address, address);
        } else {
            const inRange = SelContext.isSelected(address);
            const min = bigIntMin(inRange ? prev : this.range.start, address);
            const max = bigIntMax(inRange ? prev : this.range.end, address);
            this.range = new SelRange(min, max);
        }
        SelContext.eventEmitter.emit('changed', this.range);
    }

    public addRow(addr: bigint, row: HexDataRow) {
        this.addrToRowNode.set(addr, row);
    }

    public removeRow(addr: bigint) {
        this.addrToRowNode.delete(addr);
    }

    public clear() {
        if (!this.range || this.range.start !== this.range.end) {
            SelContext.eventEmitter.emit('changed', undefined);
        }
        this.range = undefined;
        this.current = undefined;
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
        }
    }

    public copyToClipboard() {
        const range = this.range;
        const doc = DualViewDoc.currentDoc;
        if (range && doc) {
            const isByte = doc.format === '1-byte';
            const wSize = isByte ? 1n : doc.format === '4-byte' ? 4n : 8n;
            const rSize = isByte ? 16n : 32n;
            let addr = (range.start / rSize) * rSize;
            const text: string[] = [];
            while (addr <= range.end) {
                const row = this.addrToRowNode.get(addr);
                if (!row) {
                    break;
                }
                const data = row.getRowValues();
                if (text.length) {
                    text.push('x');
                }
                for (const val of data) {
                    if (addr < range.start) {
                    } else if (addr > range.end) {
                        break;
                    } else {
                        text.push(HexCellValue.formatValue(isByte, val));
                    }
                    addr += wSize;
                }
            }
            const str = text.join(' ').replace(/ x /g, '\n');
            navigator.clipboard.writeText(str);
        }
    }
}

function bigIntMin(a: bigint, b: bigint) {
    return a < b ? a : b;
}

function bigIntMax(a: bigint, b: bigint) {
    return a > b ? a : b;
}
