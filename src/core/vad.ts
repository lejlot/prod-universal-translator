const RATE = 16000;
const SUB = 320;
const SUB_MS = (SUB / RATE) * 1000;
const BYTES_PER_MS = 32;
export interface GateOptions {
    prerollMs: number;
    hangoverMs: number;
    onsetMs: number;
    onsetWindowMs: number;
    marginDb: number;
    minDb: number;
    periodicity: number;
}
export const DEFAULT_GATE: GateOptions = {
    prerollMs: 700,
    hangoverMs: 4000,
    onsetMs: 80,
    onsetWindowMs: 300,
    marginDb: 4,
    minDb: -62,
    periodicity: 0.55,
};
export class SpeechGate {
    open = false;
    private opts: GateOptions;
    private floor = Number.NaN;
    private clockMs = 0;
    private lastVoicedMs = -Infinity;
    private recent: boolean[] = [];
    private prev = new Float32Array(SUB);
    private cur = new Float32Array(SUB);
    private fill = 0;
    private preroll: Uint8Array[] = [];
    private prerollBytes = 0;
    constructor(opts: Partial<GateOptions> = {}) {
        this.opts = { ...DEFAULT_GATE, ...opts };
    }
    push(pcm: Uint8Array) {
        if (!this.open) {
            this.preroll.push(pcm);
            this.prerollBytes += pcm.byteLength;
            const max = this.opts.prerollMs * BYTES_PER_MS;
            while (this.prerollBytes - this.preroll[0].byteLength >= max)
                this.prerollBytes -= this.preroll.shift()!.byteLength;
        }
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i + 1 < pcm.byteLength; i += 2) {
            this.cur[this.fill++] = view.getInt16(i, true) / 32768;
            if (this.fill === SUB) {
                this.step();
                this.fill = 0;
            }
        }
    }
    takePreroll(): Uint8Array[] {
        const out = this.preroll;
        this.preroll = [];
        this.prerollBytes = 0;
        return out;
    }
    close() {
        this.open = false;
        this.recent = [];
    }
    private step() {
        const db = levelDb(this.cur);
        this.trackFloor(db);
        const voiced = db > this.floor + this.opts.marginDb && db > this.opts.minDb && periodicity(this.prev, this.cur) > this.opts.periodicity;
        this.clockMs += SUB_MS;
        this.recent.push(voiced);
        if (this.recent.length > this.opts.onsetWindowMs / SUB_MS)
            this.recent.shift();
        if (voiced)
            this.lastVoicedMs = this.clockMs;
        if (!this.open) {
            const voicedMs = this.recent.filter(Boolean).length * SUB_MS;
            if (voicedMs >= this.opts.onsetMs)
                this.open = true;
        }
        else if (this.clockMs - this.lastVoicedMs > this.opts.hangoverMs) {
            this.close();
        }
        const t = this.prev;
        this.prev = this.cur;
        this.cur = t;
    }
    private trackFloor(db: number) {
        if (Number.isNaN(this.floor))
            this.floor = db;
        else if (db < this.floor)
            this.floor += (db - this.floor) * 0.3;
        else
            this.floor += Math.min(db - this.floor, 12) * 0.004;
        this.floor = Math.max(this.floor, -90);
    }
}
function levelDb(x: Float32Array): number {
    let e = 0;
    for (let i = 0; i < x.length; i++)
        e += x[i] * x[i];
    return 10 * Math.log10(e / x.length + 1e-12);
}
function periodicity(prev: Float32Array, cur: Float32Array): number {
    const n = SUB;
    const d = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
        const a = i < n / 2 ? prev : cur;
        const j = (i % (n / 2)) * 2;
        d[i] = (a[j] + a[j + 1]) / 2;
        mean += d[i];
    }
    mean /= n;
    for (let i = 0; i < n; i++)
        d[i] -= mean;
    let dipped = false;
    let best = 0;
    for (let lag = 1; lag <= 114; lag++) {
        let xy = 0;
        let xx = 0;
        let yy = 0;
        for (let i = 0; i + lag < n; i++) {
            xy += d[i] * d[i + lag];
            xx += d[i] * d[i];
            yy += d[i + lag] * d[i + lag];
        }
        const r = xy / Math.sqrt(xx * yy + 1e-12);
        if (r < 0.2)
            dipped = true;
        if (dipped && lag >= 20 && r > best)
            best = r;
    }
    return best;
}
