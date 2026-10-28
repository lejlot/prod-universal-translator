export type Measure = (text: string) => number;
export interface Line {
    text: string;
    start: number;
    first: boolean;
}
export function wrap(text: string, width: number, measure: Measure): Line[] {
    const lines: Line[] = [];
    let at = 0;
    for (const para of text.split('\n')) {
        let line = '';
        let lineStart = at;
        let first = true;
        const push = (text: string, start: number) => {
            lines.push({ text, start, first });
            first = false;
        };
        const words = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = words.exec(para))) {
            let word = m[0];
            let wordAt = at + m.index;
            const joined = line ? `${line} ${word}` : word;
            if (measure(joined) <= width) {
                if (!line)
                    lineStart = wordAt;
                line = joined;
                continue;
            }
            if (line)
                push(line, lineStart);
            line = '';
            while (word.length > 1 && measure(word) > width) {
                const cut = Math.max(1, fitChars(word, width, measure));
                push(word.slice(0, cut), wordAt);
                word = word.slice(cut);
                wordAt += cut;
            }
            line = word;
            lineStart = wordAt;
        }
        if (line)
            push(line, lineStart);
        at += para.length + 1;
    }
    return lines;
}
function fitChars(text: string, width: number, measure: Measure): number {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (measure(text.slice(0, mid)) <= width)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}
export function fitLine(text: string, width: number, measure: Measure): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (measure(flat) <= width)
        return flat;
    const n = fitChars(flat, width - measure('…'), measure);
    return flat.slice(0, n).trimEnd() + '…';
}
export function wrapMax(text: string, width: number, max: number, measure: Measure): string[] {
    const lines = wrap(text, width, measure);
    if (lines.length <= max)
        return lines.map(l => l.text);
    const kept = lines.slice(0, max).map(l => l.text);
    kept[max - 1] = fitLine(text.slice(lines[max - 1].start), width, measure);
    return kept;
}
export class ScrollBox {
    private start = 0;
    private latest = '';
    private width = 0;
    private capacity = 0;
    private measure: Measure = s => s.length;
    private browsing: string[] | null = null;
    private offset = 0;
    private top = '';
    lines(text: string, width: number, capacity: number, measure: Measure): string[] {
        if (capacity < 1)
            return [];
        this.latest = text;
        this.width = width;
        this.capacity = capacity;
        this.measure = measure;
        if (this.browsing)
            return this.browsing.slice(this.offset, this.offset + capacity);
        this.start = this.locate(text);
        let lines = wrap(text.slice(this.start), width, measure);
        if (lines.length > capacity) {
            const at = lines[lines.length - capacity].start;
            this.start += at;
            lines = lines.slice(lines.length - capacity).map(l => ({ ...l, start: l.start - at }));
        }
        const end = lines.length > 1 ? lines[1].start : text.length - this.start;
        this.top = text.slice(this.start, this.start + end).trimEnd();
        return lines.map(l => l.text);
    }
    scroll(delta: number) {
        if (!this.capacity)
            return;
        if (!this.browsing) {
            const lines = wrap(this.latest, this.width, this.measure);
            this.browsing = lines.map(l => l.text);
            this.offset = 0;
            for (let i = 0; i < lines.length && lines[i].start <= this.start; i++)
                this.offset = i;
        }
        const end = Math.max(0, this.browsing.length - this.capacity);
        this.offset = Math.max(0, Math.min(end, this.offset + delta));
        if (delta > 0 && this.offset === end)
            this.browsing = null;
    }
    private locate(text: string): number {
        if (!this.top)
            return 0;
        if (text.startsWith(this.top, this.start))
            return this.start;
        const at = text.lastIndexOf(this.top);
        return at >= 0 ? at : 0;
    }
    reset() {
        this.start = 0;
        this.top = '';
        this.latest = '';
        this.browsing = null;
        this.offset = 0;
    }
}
export class ReadingBox<T> {
    private key = '';
    private content: T[] = [];
    private capacity = 0;
    private offset = 0;
    lines(key: string, content: T[], capacity: number): T[] {
        if (key !== this.key)
            this.offset = 0;
        this.key = key;
        this.content = content;
        this.capacity = Math.max(0, capacity);
        this.offset = Math.min(this.offset, Math.max(0, content.length - this.capacity));
        return content.slice(this.offset, this.offset + this.capacity);
    }
    scroll(delta: number) {
        this.offset = Math.max(0, Math.min(Math.max(0, this.content.length - this.capacity), this.offset + delta));
    }
}
