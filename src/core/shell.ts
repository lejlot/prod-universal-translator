import { CreateStartUpPageContainer, ImageContainerProperty, ImageRawDataUpdate, ImageRawDataUpdateResult, MenuContainerProperty, MenuItemProperty, RebuildPageContainer, StartUpPageCreateResult, TextContainerProperty, TextContainerUpgrade, utf8ByteLength, type EvenHubEvent, } from '@evenrealities/even_hub_sdk';
import { Emitter } from './emitter';
import { parseHubEvent, type Lifecycle } from './events';
import { sanitize } from './glyphs';
import type { Host } from './host';
import { withTimeout, type BleQueue } from './queue';
import { Roller } from './roller';
import { LINE_HEIGHT, oneLine, spread, textWidth } from './textfit';
import type { Action, Brightness, ContentProvider, Gesture, HudModule, ImagePanel, PanelCtx, PanelSpec, TextPanel, ViewSpec } from './types';
export const SCREEN_W = 576;
export const SCREEN_H = 288;
const MAX_CREATE_CHARS = 1000;
const MAX_UPGRADE_CHARS = 2000;
const GESTURE_HUSH_MS = 1500;
const SWIPE_TAP_GUARD_MS = 450;
const FLASH_MS = 2500;
const IMAGE_DRAW_MS = 8000;
const EVENT_LAYER = 'evt';
export const HEADER: TextPanel = { kind: 'text', id: 'header', source: 'shell.header', rect: { x: 0, y: 0, w: SCREEN_W, h: 30 }, padding: 1, brightness: 3 };
interface HeaderState {
    tag: string;
    info: string[];
    alerts: string[];
    status: string[];
}
export type MirrorEvent = {
    kind: 'page';
    view: ViewSpec;
    panels: PanelSpec[];
    texts: Record<string, string>;
} | {
    kind: 'text';
    id: string;
    content: string;
} | {
    kind: 'image';
    id: string;
    bytes: Uint8Array;
} | {
    kind: 'menu';
    items: string[];
};
interface Mounted {
    view: ViewSpec;
    ids: Map<string, number>;
    sent: Map<string, string>;
    bright: Map<string, number>;
    imageHash: Map<string, number>;
    drawing: Set<string>;
    redraw: Set<string>;
    menuActions: Action[];
}
export class Shell {
    readonly mirror = new Emitter<MirrorEvent>();
    readonly lifecycle = new Emitter<Lifecycle>();
    readonly ready: Promise<void>;
    private markReady!: () => void;
    private modules: HudModule[] = [];
    private providers = new Map<string, ContentProvider>();
    private dashboard: ViewSpec | null = null;
    private mounted: Mounted | null = null;
    private started = false;
    private flashMsg: {
        text: string;
        until: number;
    } | null = null;
    private grabbedBy: HudModule | null = null;
    private dirty = new Set<string>();
    private quietDirty = new Set<string>();
    private flushQueued = false;
    private status = { battery: undefined as number | undefined, connected: true, phone: undefined as number | undefined };
    private readyAt = 0;
    private lastSwipeAt = 0;
    private headerRoller = new Roller(() => this.invalidate('shell.header', { quiet: true }));
    constructor(private host: Host, private queue: BleQueue) {
        this.ready = new Promise(resolve => (this.markReady = resolve));
        this.provide('shell.header', { text: ctx => this.headerText(ctx) });
        window.setInterval(() => this.invalidate('shell.header'), 30000);
    }
    addModule(m: HudModule) {
        this.modules.push(m);
    }
    provide(source: string, provider: ContentProvider) {
        this.providers.set(source, provider);
    }
    get view(): ViewSpec | undefined {
        return this.mounted?.view;
    }
    setPhoneBattery(level: number | undefined) {
        this.status = { ...this.status, phone: level };
        this.invalidate('shell.header');
    }
    setDeviceStatus(battery: number | undefined, connected: boolean) {
        this.status = { ...this.status, battery, connected };
        this.invalidate('shell.header');
    }
    grab(m: HudModule | null) {
        this.grabbedBy = m;
    }
    mount(view: ViewSpec) {
        validateView(view);
        this.dashboard = view;
        this.queue.enqueue('page', 'page', () => this.buildPage(view), 10000);
    }
    invalidate(source: string, opts: {
        quiet?: boolean;
    } = {}) {
        if (!this.mounted)
            return;
        if (opts.quiet && !this.dirty.has(source))
            this.quietDirty.add(source);
        else if (!opts.quiet)
            this.quietDirty.delete(source);
        this.dirty.add(source);
        if (!this.flushQueued) {
            this.flushQueued = true;
            queueMicrotask(() => {
                this.flushQueued = false;
                this.flush();
            });
        }
    }
    invalidateModule(id: string) {
        for (const key of this.providers.keys())
            if (key.startsWith(`${id}.`))
                this.invalidate(key);
    }
    private async buildPage(view: ViewSpec) {
        const ids = new Map<string, number>();
        const texts: Record<string, string> = {};
        const bright = new Map<string, number>();
        const textObject: TextContainerProperty[] = [];
        const imageObject: ImageContainerProperty[] = [];
        let nextId = 1;
        let z = 1;
        ids.set(EVENT_LAYER, nextId);
        textObject.push(new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: SCREEN_W,
            height: SCREEN_H,
            borderWidth: 0,
            borderColor: 0,
            paddingLength: 0,
            containerID: nextId++,
            containerName: EVENT_LAYER,
            content: ' ',
            isEventCapture: 1,
            zOrderIndex: z++,
        }));
        for (const panel of view.panels) {
            const id = nextId++;
            ids.set(panel.id, id);
            const r = panel.rect;
            if (panel.kind === 'text') {
                const ctx = this.ctxFor(panel, view);
                const content = clip(this.renderText(ctx), MAX_CREATE_CHARS) || ' ';
                const level = this.brightnessFor(ctx);
                texts[panel.id] = content;
                bright.set(panel.id, level);
                textObject.push(new TextContainerProperty({
                    xPosition: r.x,
                    yPosition: r.y,
                    width: r.w,
                    height: r.h,
                    borderWidth: panel.border?.width ?? 0,
                    borderColor: panel.border?.color ?? 0,
                    borderRadius: panel.border?.radius ?? 0,
                    paddingLength: panel.padding ?? 0,
                    containerID: id,
                    containerName: panel.id,
                    content,
                    isEventCapture: 0,
                    zOrderIndex: z++,
                    textColor: level,
                }));
            }
            else if (panel.kind === 'image') {
                imageObject.push(new ImageContainerProperty({
                    xPosition: r.x,
                    yPosition: r.y,
                    width: r.w,
                    height: r.h,
                    containerID: id,
                    containerName: panel.id,
                    zOrderIndex: z++,
                }));
            }
        }
        const menuActions = this.menuActions();
        const menuObject = new MenuContainerProperty({
            menuItems: menuActions.map((a, i) => new MenuItemProperty({ itemName: menuName(a.menuLabel ?? a.label), itemID: i + 1 })),
        });
        const containerTotalNum = textObject.length + imageObject.length;
        const page = { containerTotalNum, textObject, listObject: [], imageObject, menuObject };
        let ok: boolean;
        if (!this.started) {
            const result = await this.host.createStartUpPageContainer(new CreateStartUpPageContainer(page));
            ok = result === StartUpPageCreateResult.success;
            if (!ok && result === StartUpPageCreateResult.invalid) {
                ok = await this.host.rebuildPageContainer(new RebuildPageContainer(page));
            }
            if (ok) {
                this.started = true;
                this.readyAt = Date.now();
                this.markReady();
            }
            else
                console.error('[shell] createStartUpPageContainer failed:', result);
        }
        else {
            ok = await this.host.rebuildPageContainer(new RebuildPageContainer(page));
            if (!ok)
                console.error('[shell] rebuildPageContainer failed');
        }
        if (!ok)
            return;
        this.mounted = { view, ids, sent: new Map(Object.entries(texts)), bright, imageHash: new Map(), drawing: new Set(), redraw: new Set(), menuActions };
        this.mirror.emit({ kind: 'page', view, panels: view.panels, texts });
        this.mirror.emit({ kind: 'menu', items: menuActions.map(a => a.menuLabel ?? a.label) });
        for (const p of view.panels)
            this.dirty.add(p.source);
        this.flush();
    }
    private flush() {
        const m = this.mounted;
        if (!m)
            return;
        const dirty = this.dirty;
        const quiet = this.quietDirty;
        this.dirty = new Set();
        this.quietDirty = new Set();
        for (const panel of m.view.panels) {
            if (!dirty.has(panel.source))
                continue;
            if (panel.kind === 'text')
                this.queueText(panel, m, quiet.has(panel.source));
            else if (panel.kind === 'image')
                this.queueImage(panel, m);
        }
    }
    private queueText(panel: TextPanel, m: Mounted, quiet = false) {
        const ctx = this.ctxFor(panel, m.view);
        const changed = m.sent.get(panel.id) !== (clip(this.renderText(ctx), MAX_UPGRADE_CHARS) || ' ') || m.bright.get(panel.id) !== this.brightnessFor(ctx);
        this.queue.enqueue(`text:${panel.id}`, 'text', async () => {
            if (m !== this.mounted)
                return;
            const ctx = this.ctxFor(panel, m.view);
            const content = clip(this.renderText(ctx), MAX_UPGRADE_CHARS) || ' ';
            const level = this.brightnessFor(ctx);
            const relight = m.bright.get(panel.id) !== level;
            if (m.sent.get(panel.id) === content && !relight)
                return;
            const ok = await this.host.textContainerUpgrade(new TextContainerUpgrade({
                containerID: m.ids.get(panel.id),
                containerName: panel.id,
                content,
                ...(relight ? { textColor: level } : {}),
            }));
            if (ok) {
                m.sent.set(panel.id, content);
                m.bright.set(panel.id, level);
                this.mirror.emit({ kind: 'text', id: panel.id, content });
            }
        }, undefined, changed && !quiet);
    }
    private queueImage(panel: ImagePanel, m: Mounted) {
        const provider = this.providers.get(panel.source);
        if (!provider?.image)
            return;
        if (m.drawing.has(panel.id)) {
            m.redraw.add(panel.id);
            return;
        }
        m.drawing.add(panel.id);
        withTimeout(provider.image(this.ctxFor(panel, m.view)), IMAGE_DRAW_MS, `draw ${panel.id}`)
            .then(bytes => {
            if (bytes && m === this.mounted)
                this.sendImage(panel, m, bytes);
        })
            .catch(err => console.warn('[shell] image', panel.id, err))
            .finally(() => {
            m.drawing.delete(panel.id);
            if (m.redraw.delete(panel.id) && m === this.mounted)
                this.queueImage(panel, m);
        });
    }
    private sendImage(panel: ImagePanel, m: Mounted, bytes: Uint8Array) {
        const hash = fnv1a(bytes);
        if (m.imageHash.get(panel.id) === hash)
            return;
        this.queue.enqueue(`image:${panel.id}`, 'image', async () => {
            if (m !== this.mounted || m.imageHash.get(panel.id) === hash)
                return;
            const result = await this.host.updateImageRawData(new ImageRawDataUpdate({ containerID: m.ids.get(panel.id), containerName: panel.id, imageData: bytes }));
            if (result === ImageRawDataUpdateResult.success) {
                m.imageHash.set(panel.id, hash);
                this.mirror.emit({ kind: 'image', id: panel.id, bytes });
            }
            else {
                console.warn('[shell] image', panel.id, result);
            }
        });
    }
    private renderText(ctx: PanelCtx): string {
        const provider = this.providers.get(ctx.panel.source);
        try {
            return sanitize(provider?.text?.(ctx) ?? '');
        }
        catch (err) {
            console.error('[shell] provider', ctx.panel.source, err);
            return '';
        }
    }
    private brightnessFor(ctx: PanelCtx): Brightness {
        const panel = ctx.panel as TextPanel;
        try {
            return this.providers.get(panel.source)?.brightness?.(ctx) ?? panel.brightness ?? 4;
        }
        catch {
            return panel.brightness ?? 4;
        }
    }
    private ctxFor(panel: PanelSpec, view: ViewSpec): PanelCtx {
        const inset = panel.kind === 'text' ? (panel.padding ?? 0) + (panel.border?.width ?? 0) : 0;
        const innerW = Math.max(0, panel.rect.w - 2 * inset);
        const innerH = Math.max(0, panel.rect.h - 2 * inset);
        return { panel, view, innerW, innerH, maxLines: Math.max(1, Math.floor(innerH / LINE_HEIGHT)) };
    }
    flash(text: string, ms = FLASH_MS) {
        this.flashMsg = { text, until: Date.now() + ms };
        this.invalidate('shell.header');
        window.setTimeout(() => this.invalidate('shell.header'), ms + 50);
    }
    headerState(): HeaderState {
        let tag = this.clock();
        if (this.flashMsg && Date.now() < this.flashMsg.until)
            tag = this.flashMsg.text;
        const pct = (label: string, n: number | undefined) => (n === undefined ? '' : `${label} ${n < 15 ? '!' : ''}${Math.round(n)}%`);
        return {
            tag,
            info: this.modules.map(m => m.info?.() ?? '').filter(Boolean),
            alerts: this.modules.map(m => m.badge?.() ?? '').filter(Boolean),
            status: [pct('GL', this.status.battery), pct('PH', this.status.phone), ...this.modules.map(m => m.status?.() ?? '')].filter(Boolean),
        };
    }
    private headerText(ctx: PanelCtx): string {
        const s = this.headerState();
        const width = ctx.innerW - 10;
        const gap = textWidth(' ━━ ');
        const alerts = s.alerts.map(a => a.toUpperCase()).join(' ┃ ');
        const status = s.status.join('  ');
        const body = [alerts, status].filter(Boolean).join(' ┃ ');
        const clockOnly = `◢ ${s.tag}`;
        const rightRoom = width - textWidth(clockOnly) - gap;
        const right = !body ? '◤' : textWidth(`${body} ◤`) <= rightRoom ? `${body} ◤` : `${oneLine(body, rightRoom - textWidth(' ◤'))} ◤`;
        const flashing = s.tag !== this.clock();
        const leftRoom = width - textWidth(right) - gap;
        let info = flashing ? [] : s.info;
        const prefix = `${clockOnly} ┃ `;
        while (info.length > 1 && textWidth(prefix + info.join('  ')) > leftRoom)
            info = info.slice(1);
        const rolled = this.headerRoller.fit(info.join('  '), leftRoom - textWidth(prefix) - 2);
        return spread(info.length ? prefix + rolled : clockOnly, right, width, '━');
    }
    private clock(now = new Date()) {
        return `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    private menuActions(): Action[] {
        const actions = this.modules
            .flatMap(m => m.actions?.() ?? [])
            .filter(a => a.inMenu && (a.enabled?.() ?? true))
            .slice(0, 9);
        return [...actions, { id: 'shell.exit', label: 'Exit HUD', inMenu: true, run: () => this.exit() }];
    }
    exit() {
        this.queue.enqueue('exit', 'page', () => this.host.shutDownPageContainer(1));
    }
    handleEvent(event: EvenHubEvent) {
        const signal = parseHubEvent(event);
        if (!signal)
            return;
        if (signal.type === 'lifecycle') {
            this.lifecycle.emit(signal.lifecycle);
            return;
        }
        if (signal.type === 'menu') {
            this.runMenuItem(signal.itemId);
            return;
        }
        const g = signal.gesture;
        const now = Date.now();
        this.queue.hush(GESTURE_HUSH_MS);
        if (now - this.readyAt < 1200)
            return;
        if (g.kind === 'up' || g.kind === 'down')
            this.lastSwipeAt = now;
        if ((g.kind === 'tap' || g.kind === 'double') && now - this.lastSwipeAt < SWIPE_TAP_GUARD_MS)
            return;
        this.dispatch(g);
    }
    runMenuItem(itemId: number) {
        const action = this.mounted?.menuActions[itemId - 1];
        if (action)
            void action.run();
    }
    dispatch(g: Gesture) {
        const view = this.mounted?.view ?? this.dashboard;
        if (!view)
            return;
        this.queue.hush(GESTURE_HUSH_MS);
        for (const m of this.modules)
            if (m.onShortcut?.(g, view))
                return;
        if (this.grabbedBy?.onGesture?.(g, view) || this.grabbedBy?.onGlobalGesture?.(g, view))
            return;
        const main = this.modules.find(m => m.id === view.focus);
        if (main?.onGesture?.(g, view))
            return;
        for (const m of this.modules)
            if (m.onGlobalGesture?.(g, view))
                return;
    }
}
function clip(s: string, max: number): string {
    if (s.length <= max)
        return s;
    return s.slice(s.length - max);
}
function menuName(label: string): string {
    let s = sanitize(label);
    while (utf8ByteLength(s) > 32)
        s = s.slice(0, -1);
    return s;
}
function fnv1a(bytes: Uint8Array): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
function validateView(v: ViewSpec) {
    const ids = new Set<string>();
    let texts = 0;
    let images = 0;
    for (const p of v.panels) {
        if (p.id.length > 16)
            throw new Error(`panel id "${p.id}" is longer than 16 chars`);
        if (ids.has(p.id) || p.id === EVENT_LAYER)
            throw new Error(`duplicate panel id "${p.id}"`);
        ids.add(p.id);
        if (p.kind === 'image') {
            images++;
            if (p.rect.w < 20 || p.rect.w > 288 || p.rect.h < 20 || p.rect.h > 144) {
                throw new Error(`image panel "${p.id}" must be 20–288 × 20–144`);
            }
        }
        else
            texts++;
        const r = p.rect;
        if (r.x < 0 || r.y < 0 || r.x + r.w > SCREEN_W || r.y + r.h > SCREEN_H) {
            throw new Error(`panel "${p.id}" is off screen`);
        }
    }
    if (texts + 1 > 8)
        throw new Error(`the dashboard has more than 7 text panels`);
    if (images > 4)
        throw new Error(`the dashboard has more than 4 image panels`);
}
