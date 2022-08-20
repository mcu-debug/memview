
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
