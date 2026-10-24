import { getAdvW } from '@evenrealities/pretext';
const SUBSTITUTES: Record<string, string> = {
    '✓': '*',
    '✔': '*',
    '✕': 'x',
    '✗': 'x',
    '↰': '←',
    '↱': '→',
    '↖': '←',
    '↗': '→',
    '↙': '←',
    '↘': '→',
    '◉': '●',
    '▮': '█',
    '▓': '█',
    '░': '▒',
    ' ': ' ',
    '\t': ' ',
};
const known = new Map<number, boolean>();
function supported(cp: number): boolean {
    let ok = known.get(cp);
    if (ok === undefined) {
        ok = getAdvW(cp) > 0;
        known.set(cp, ok);
    }
    return ok;
}
export function sanitize(text: string): string {
    let out = '';
    for (const ch of text) {
        if (ch === '\n' || ch === ' ') {
            out += ch;
            continue;
        }
        const sub = SUBSTITUTES[ch];
        if (sub !== undefined) {
            out += sub;
            continue;
        }
        const cp = ch.codePointAt(0)!;
        if (cp < 32)
            continue;
        if (supported(cp))
            out += ch;
    }
    return out;
}
