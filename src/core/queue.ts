export type Lane = 'page' | 'text' | 'device' | 'image' | 'misc';
const LANE_ORDER: Lane[] = ['page', 'text', 'device', 'image', 'misc'];
const TIMEOUT_MS: Record<Lane, number> = { page: 6000, text: 1000, device: 3000, image: 4000, misc: 2000 };
const MAX_IN_FLIGHT = 4;
interface Job {
    key: string;
    lane: Lane;
    channel: string;
    run: () => Promise<unknown>;
    timeoutMs: number;
    queuedAt: number;
}
const TEXT_HOT_MS = 1500;
const IMAGE_MAX_DEFER_MS = 20000;
export class BleQueue {
    private pending = new Map<string, Job>();
    private busy = new Set<string>();
    private paging = false;
    private lastTextAt = 0;
    private hushUntil = 0;
    private wakeTimer: number | null = null;
    onError: (key: string, err: unknown) => void = (_key, _err) => void 0;
    enqueue(key: string, lane: Lane, run: () => Promise<unknown>, timeoutMs = TIMEOUT_MS[lane], hot = lane === 'text') {
        this.pending.delete(key);
        const channel = lane === 'text' ? key : lane;
        this.pending.set(key, { key, lane, channel, run, timeoutMs, queuedAt: Date.now() });
        if (hot)
            this.lastTextAt = Date.now();
        this.pump();
    }
    hush(ms: number) {
        this.hushUntil = Math.max(this.hushUntil, Date.now() + ms);
    }
    drop(prefix: string) {
        for (const key of [...this.pending.keys()])
            if (key.startsWith(prefix))
                this.pending.delete(key);
    }
    get size() {
        return this.pending.size;
    }
    get inFlight() {
        return this.busy.size;
    }
    private pump() {
        for (;;) {
            if (this.paging || this.busy.size >= MAX_IN_FLIGHT)
                return;
            const next = this.pick(Date.now());
            if (!next)
                return;
            this.start(next);
        }
    }
    private pick(now: number): Job | null {
        let deferred = false;
        for (const lane of LANE_ORDER) {
            for (const job of this.pending.values()) {
                if (job.lane !== lane || this.busy.has(job.channel))
                    continue;
                if (lane === 'page') {
                    return this.busy.size ? null : job;
                }
                if (lane === 'image') {
                    const textHot = now - this.lastTextAt < TEXT_HOT_MS && now - job.queuedAt < IMAGE_MAX_DEFER_MS;
                    if (now < this.hushUntil || textHot) {
                        deferred = true;
                        continue;
                    }
                }
                return job;
            }
        }
        if (deferred && this.wakeTimer === null) {
            this.wakeTimer = window.setTimeout(() => {
                this.wakeTimer = null;
                this.pump();
            }, Math.max(50, Math.min(TEXT_HOT_MS, this.hushUntil - now)));
        }
        return null;
    }
    private start(job: Job) {
        this.pending.delete(job.key);
        this.busy.add(job.channel);
        if (job.lane === 'page')
            this.paging = true;
        withTimeout(Promise.resolve().then(job.run), job.timeoutMs, job.key)
            .catch(err => this.onError(job.key, err))
            .finally(() => {
            this.busy.delete(job.channel);
            if (job.lane === 'page')
                this.paging = false;
            this.pump();
        });
    }
}
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'call'): Promise<T> {
    let timer: number;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    });
    return Promise.race([p, timeout]).finally(() => window.clearTimeout(timer));
}
