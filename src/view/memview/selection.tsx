import { DocDebuggerStatus, DualViewDoc, DummyByte } from './dual-view-doc';
import events from 'events';
import { bigIntMax, bigIntMin, hexFmt64 } from './utils';

export class SelRange {
    constructor(readonly start: bigint, readonly end: bigint) {}
}
export class SelContext {
    public static current: SelContext | undefined;
    public static eventEmitter = new events.EventEmitter();
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
            this.range = new SelRange(address, address + BigInt(doc?.getBytesPerCell(doc.format) || 1) - 1n);
        } else {
            const inRange = SelContext.isSelected(address);
            const min = bigIntMin(inRange ? prev : this.range.start, address);
            const max = bigIntMax(inRange ? prev : this.range.end, address);
            this.range = new SelRange(min, max + BigInt(doc?.getBytesPerCell(doc.format) || 1) - 1n);
        }
        SelContext.eventEmitter.emit('changed', this.range);
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

    public async copyToClipboard() {
        const range = this.range;
        const doc = DualViewDoc.currentDoc;
        if (range && doc) {
            if (range.start > doc.maxAddress) {
                return;
            }
            const refreshPage = async (addr: bigint) => {
                try {
                    await DualViewDoc.getCurrentDocByte(addr); // This will refresh if debugger is stopped
                } catch {}
            };
            const getByteOrder = (isBigEndian: boolean, bytePerWord: number): number[] => {
                return isBigEndian
                    ? Array.from({ length: bytePerWord }, (_, index) => index)
                    : Array.from({ length: bytePerWord }, (_, index) => bytePerWord - index - 1);
            }
            const pageSize = BigInt(doc.PageSize || 512);
            const isBigEndian = doc.endian === 'big';
            const bytePerWord = doc.getBytesPerCell(doc.format);
            const byteOrder = getByteOrder(isBigEndian, bytePerWord);
            const lines: string[] = [];
            let done = false;
            let addr = doc.baseAddress + (((range.start - doc.baseAddress) / BigInt(doc.bytesPerRow)) * BigInt(doc.bytesPerRow));
            await refreshPage(addr);
            while (!done && (addr + BigInt(bytePerWord) - 1n) <= range.end && (addr + BigInt(bytePerWord) - 1n) < doc.maxAddress) {
                const row = DualViewDoc.getRowUnsafe(addr);
                let ix = 0;
                while (addr < range.start) {
                    addr++;
                    ix++;
                }
                const line: string[] = ((range.end - range.start) >= bytePerWord) ? [hexFmt64(addr, false)] : [];
                while ((ix + bytePerWord - 1) < row.length && (addr + BigInt(bytePerWord) - 1n) <= range.end) {
                    let val = 0n;
                    for (const iy of byteOrder) {
                        const byte = row[ix + iy].cur;
                        if (byte < 0) {
                            done = true;
                            break;
                        }
                        val = (val << 8n) | BigInt(byte & 0xff);
                    }
                    line.push(val.toString(16).padStart(bytePerWord * 2, '0'));
                    ix += bytePerWord;
                    addr += BigInt(bytePerWord);
                }
                if (line.length > 1) {
                    lines.push(line.join(' '));
                }
                if (!done && addr <= range.end && addr === (addr / pageSize) * pageSize) {
                    await refreshPage(addr);
                }
            }
            lines.length && lines.push('');
            const str = lines.join('\n');
            if (str) {
                // The webview also does a copy of the single cell we are now focussed on. Delay our
                // copy just a little bit so ours goes last. Wish I knew how to work around this
                // This becomes especially true, if you visit a breakpoint while debugging the copy function
                // as it would remove focus from the memory-vew. navigator.clipboard.writeText needs
                // the document to have the focus.
                setTimeout(() => {
                    navigator.clipboard.writeText(str).then(
                        () => {
                            // console.log('Worked! navigator.clipboard.writeText');
                        },
                        (e) => {
                            console.error('FAILED! navigator.clipboard.writeText', e);
                        }
                    );
                }, 5);
            }
        }
    }
}
