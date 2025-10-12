import { RowFormatType } from './shared';

export class Timekeeper {
    private start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor(public resetOnQuery = false) { }

    public deltaMs(): number {
        const now = Date.now();
        const ret = now - this.start;
        if (this.resetOnQuery) {
            this.start = now;
        }
        return ret;
    }
}

export function hexFmt64(v: bigint, doPrefix = true) {
    const str = (doPrefix ? '0x' : '') + v.toString(16).padStart(16, '0');
    return str;
}

export function bigIntMin(a: bigint, b: bigint) {
    return a < b ? a : b;
}

export function bigIntMax(a: bigint, b: bigint) {
    return a > b ? a : b;
}

// Format value based on type and endianness
export function formatValueWithType(format: RowFormatType, bytes: number[], endian: 'little' | 'big'): string {
    if (bytes.length === 0) {
        return '??';
    }

    // Check for invalid bytes
    for (const byte of bytes) {
        if (byte < 0 || byte > 255) {
            const bytesPerCell = getBytesPerFormat(format);
            return '~'.repeat(bytesPerCell * 2);
        }
    }

    // Convert bytes to hex string based on endianness
    let hexStr = '';
    if (endian === 'little') {
        // Little endian: display bytes in reverse order (lowest byte first)
        for (let i = bytes.length - 1; i >= 0; i--) {
            hexStr += bytes[i].toString(16).padStart(2, '0');
        }
    } else {
        // Big endian: display bytes in normal order (highest byte first)
        for (const byte of bytes) {
            hexStr += byte.toString(16).padStart(2, '0');
        }
    }

    return hexStr.toLowerCase();
}

function getBytesPerFormat(format: RowFormatType): number {
    switch (format) {
        case '1-byte': return 1;
        case '2-byte': return 2;
        case '4-byte': return 4;
        case '8-byte': return 8;
        default: return 1;
    }
}
