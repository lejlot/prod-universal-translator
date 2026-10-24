import type { Host } from './host';
import type { BleQueue } from './queue';
const PREFIX = 'hud.';
export class Store {
    private cache = new Map<string, string>();
    private timers = new Map<string, number>();
    constructor(private host: Host, private queue: BleQueue) { }
    async load<T>(key: string, fallback: T): Promise<T> {
        try {
            const raw = await this.host.getLocalStorage(PREFIX + key);
            if (!raw)
                return fallback;
            this.cache.set(key, raw);
            return { ...fallback, ...JSON.parse(raw) } as T;
        }
        catch (err) {
            console.warn(`[store] load ${key}`, err);
            return fallback;
        }
    }
    save(key: string, value: unknown, debounceMs = 800) {
        const raw = JSON.stringify(value);
        if (this.cache.get(key) === raw)
            return;
        this.cache.set(key, raw);
        const existing = this.timers.get(key);
        if (existing !== undefined)
            window.clearTimeout(existing);
        this.timers.set(key, window.setTimeout(() => {
            this.timers.delete(key);
            this.write(key, raw);
        }, debounceMs));
    }
    flush() {
        for (const [key, timer] of this.timers) {
            window.clearTimeout(timer);
            const raw = this.cache.get(key);
            if (raw !== undefined)
                this.write(key, raw);
        }
        this.timers.clear();
    }
    private write(key: string, raw: string) {
        this.queue.enqueue(`store:${key}`, 'misc', () => this.host.setLocalStorage(PREFIX + key, raw));
    }
}
