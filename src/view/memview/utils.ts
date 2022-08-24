
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

export function hexFmt64(v: bigint) {
    const str = '0x' + v.toString(16).padStart(16, '0');
    return str;
}
