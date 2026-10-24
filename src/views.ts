import { HEADER } from './core/shell';
import { LINE_HEIGHT } from './core/textfit';
import type { Rect, ViewSpec } from './core/types';
export const SCREEN_W = 576;
export const SCREEN_H = 288;
export const ROWS = 9;
export const TOP_ROWS = 3;
export const WRAP_MARGIN_PX = 10;
export const BODY: Rect = { x: 2, y: 34, w: 572, h: ROWS * LINE_HEIGHT };
export const DASHBOARD: ViewSpec = {
    id: 'home',
    title: 'Universal Translator',
    focus: 'translate',
    panels: [
        HEADER,
        { kind: 'text', id: 'dim', source: 'view.dim', rect: BODY, brightness: 2 },
        { kind: 'text', id: 'bright', source: 'view.bright', rect: BODY, brightness: 4 },
    ],
};
export interface Row {
    dim?: string;
    bright?: string;
}
export interface BodyParts {
    top(width: number, rows: number): Row[];
    english(width: number, rows: number): Row[];
}
export function composeBody(p: BodyParts): Row[] {
    const width = BODY.w - WRAP_MARGIN_PX;
    return [...fill(p.top(width, TOP_ROWS), TOP_ROWS), ...fill(p.english(width, ROWS - TOP_ROWS), ROWS - TOP_ROWS)];
}
export function layerText(rows: Row[], tone: 'dim' | 'bright'): string {
    const lines = rows.map(r => r[tone] ?? '');
    while (lines.length && !lines[lines.length - 1])
        lines.pop();
    return lines.join('\n') || ' ';
}
function fill(rows: Row[], n: number): Row[] {
    const out = rows.slice(0, n);
    while (out.length < n)
        out.push({});
    return out;
}
