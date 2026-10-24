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
    private top = '';
    lines(text: string, width: number, capacity: number, measure: Measure): string[] {
        if (capacity < 1)
            return [];
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
    }
}
