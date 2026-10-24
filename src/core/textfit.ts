import { getTextWidth, measureTextWrap, pxTruncate } from '@evenrealities/pretext';
export const LINE_HEIGHT = 27;
export function lineCount(text: string, width: number): number {
    if (!text)
        return 0;
    return measureTextWrap(text, width).lineCount;
}
export function fitTail(text: string, width: number, maxLines: number): string {
    if (maxLines <= 0 || !text)
        return '';
    if (lineCount(text, width) <= maxLines)
        return text;
    const starts: number[] = [];
    for (let i = 1; i < text.length; i++) {
        const prev = text[i - 1];
        if ((prev === ' ' || prev === '\n') && text[i] !== ' ' && text[i] !== '\n')
            starts.push(i);
    }
    if (!starts.length)
        return fitTailChars(text, width, maxLines);
    let lo = 0;
    let hi = starts.length - 1;
    let best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lineCount(text.slice(starts[mid]), width) <= maxLines) {
            best = mid;
            hi = mid - 1;
        }
        else {
            lo = mid + 1;
        }
    }
    if (best === -1)
        return fitTailChars(text.slice(starts[starts.length - 1]), width, maxLines);
    return text.slice(starts[best]);
}
function fitTailChars(text: string, width: number, maxLines: number): string {
    let lo = 0;
    let hi = text.length - 1;
    let best = text.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lineCount(text.slice(mid), width) <= maxLines) {
            best = mid;
            hi = mid - 1;
        }
        else {
            lo = mid + 1;
        }
    }
    return text.slice(best);
}
export function fitHead(text: string, width: number, maxLines: number): string {
    if (maxLines <= 0 || !text)
        return '';
    if (lineCount(text, width) <= maxLines)
        return text;
    let lo = 0;
    let hi = text.length;
    let best = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lineCount(text.slice(0, mid).trimEnd() + '…', width) <= maxLines) {
            best = mid;
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }
    return text.slice(0, best).trimEnd() + '…';
}
export function oneLine(text: string, width: number): string {
    return pxTruncate(text.replace(/\n/g, ' '), width);
}
export function textWidth(text: string): number {
    return getTextWidth(text);
}
export function spread(left: string, right: string, width: number, fill = ' '): string {
    const space = Math.max(1, getTextWidth(' '));
    const room = width - getTextWidth(left) - getTextWidth(right);
    if (room < space)
        return oneLine(`${left} ${right}`, width);
    const spaces = (n: number) => {
        let line = left + ' '.repeat(n) + right;
        while (n > 1 && getTextWidth(line) > width)
            line = left + ' '.repeat(--n) + right;
        return line;
    };
    if (fill === ' ')
        return spaces(Math.floor(room / space));
    const unit = Math.max(1, getTextWidth(fill));
    let n = Math.floor((room - 2 * space) / unit);
    if (n < 1)
        return spaces(Math.floor(room / space));
    let slack = Math.floor((room - 2 * space - n * unit) / space);
    let line = `${left} ${fill.repeat(n)}${' '.repeat(slack)} ${right}`;
    while (getTextWidth(line) > width && (slack > 0 || n > 1)) {
        if (slack > 0)
            slack--;
        else
            n--;
        line = `${left} ${fill.repeat(n)}${' '.repeat(slack)} ${right}`;
    }
    return line;
}
export function clipPx(text: string, width: number): string {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (getTextWidth(text.slice(0, mid)) <= width)
            lo = mid;
        else
            hi = mid - 1;
    }
    return text.slice(0, lo);
}
export const MARQUEE_STEP_MS = 450;
const MARQUEE_STEP_CHARS = 2;
const MARQUEE_PAUSE_STEPS = 4;
export function marquee(text: string, width: number, tick: number): string {
    const line = text.replace(/\n/g, ' ');
    if (getTextWidth(line) <= width)
        return line;
    const loop = `${line}   ·   `;
    const steps = Math.ceil(loop.length / MARQUEE_STEP_CHARS);
    const phase = tick % (MARQUEE_PAUSE_STEPS + steps);
    const at = Math.max(0, phase - MARQUEE_PAUSE_STEPS) * MARQUEE_STEP_CHARS;
    return clipPx((loop + line).slice(at % loop.length), width);
}
export function overflows(text: string, width: number): boolean {
    return getTextWidth(text.replace(/\n/g, ' ')) > width;
}
export function wrapLines(text: string, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
        let line = '';
        for (const word of para.split(/\s+/).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word;
            if (getTextWidth(next) <= width) {
                line = next;
                continue;
            }
            if (line)
                out.push(line);
            let rest = word;
            while (getTextWidth(rest) > width) {
                const piece = clipPx(rest, width);
                if (!piece)
                    break;
                out.push(piece);
                rest = rest.slice(piece.length);
            }
            line = rest;
        }
        out.push(line);
    }
    return out;
}
