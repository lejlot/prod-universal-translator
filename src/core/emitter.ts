export class Emitter<T = void> {
    private listeners = new Set<(value: T) => void>();
    on(fn: (value: T) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    emit(value: T) {
        for (const fn of [...this.listeners]) {
            try {
                fn(value);
            }
            catch (err) {
                void 0;
            }
        }
    }
}
