export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export type Brightness = 0 | 1 | 2 | 3 | 4;
interface PanelBase {
    id: string;
    rect: Rect;
    source: string;
}
export interface TextPanel extends PanelBase {
    kind: 'text';
    brightness?: Brightness;
    padding?: number;
    border?: {
        width: number;
        color: number;
        radius?: number;
    };
}
export interface ImagePanel extends PanelBase {
    kind: 'image';
}
export type PanelSpec = TextPanel | ImagePanel;
export interface ViewSpec {
    id: string;
    title: string;
    panels: PanelSpec[];
    focus?: string;
}
export interface PanelCtx {
    panel: PanelSpec;
    view: ViewSpec;
    innerW: number;
    innerH: number;
    maxLines: number;
}
export interface ContentProvider {
    text?(ctx: PanelCtx): string;
    image?(ctx: PanelCtx): Promise<Uint8Array | null>;
    brightness?(ctx: PanelCtx): Brightness;
}
export type GestureKind = 'tap' | 'double' | 'up' | 'down' | 'hold' | 'release' | 'pinch';
export type InputSource = 'ring' | 'left' | 'right' | 'unknown';
export interface Gesture {
    kind: GestureKind;
    source: InputSource;
}
export interface Action {
    id: string;
    label: string;
    menuLabel?: string;
    run(): void | Promise<void>;
    inMenu?: boolean;
    enabled?(): boolean;
}
export interface HudModule {
    id: string;
    title: string;
    start?(): void | Promise<void>;
    onShortcut?(g: Gesture, view: ViewSpec): boolean;
    onGesture?(g: Gesture, view: ViewSpec): boolean;
    onGlobalGesture?(g: Gesture, view: ViewSpec): boolean;
    actions?(): Action[];
    badge?(): string;
    info?(): string;
    status?(): string;
    resume?(): void;
    stop?(): void;
}
