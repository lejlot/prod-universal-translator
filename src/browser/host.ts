import { AudioInputSource, AudioSpeakerRole, ImageRawDataUpdateResult, OsEventTypeList, StartUpPageCreateResult, type AppLocation, type AppLocationOptions, type CreateStartUpPageContainer, type DeviceInfo, type DeviceStatus, List_ItemEvent, Sys_ItemEvent, Text_ItemEvent, type EvenHubEvent, type RebuildPageContainer, } from '@evenrealities/even_hub_sdk';
import { Emitter } from '../core/emitter';
import type { Host } from '../core/host';
export class BrowserHost implements Host {
    readonly listIndex = new Emitter<number>();
    private hub = new Set<(e: EvenHubEvent) => void>();
    private locationListeners = new Set<(l: AppLocation) => void>();
    private listLength = 0;
    private index = 0;
    private mic: {
        ctx: AudioContext;
        stream: MediaStream;
    } | null = null;
    private watchId: number | null = null;
    private holding = false;
    constructor() {
        window.addEventListener('keydown', e => this.onKey(e, true));
        window.addEventListener('keyup', e => this.onKey(e, false));
    }
    private onKey(e: KeyboardEvent, down: boolean) {
        const target = e.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
            return;
        if (e.key === 'h' || e.key === 'H') {
            if (down && !this.holding) {
                this.holding = true;
                this.gesture('hold');
            }
            else if (!down && this.holding) {
                this.holding = false;
                this.gesture('release');
            }
            e.preventDefault();
            return;
        }
        if (!down || e.repeat)
            return;
        const map: Record<string, Parameters<BrowserHost['gesture']>[0]> = {
            ArrowUp: 'up',
            ArrowDown: 'down',
            Enter: 'tap',
            ' ': 'tap',
            Backspace: 'double',
            p: 'pinch',
        };
        const g = map[e.key];
        if (g) {
            e.preventDefault();
            this.gesture(g);
        }
    }
    gesture(kind: 'up' | 'down' | 'tap' | 'double' | 'hold' | 'release' | 'pinch') {
        if (kind === 'pinch') {
            return this.emit({ sysEvent: new Sys_ItemEvent({ eventSource: 2 }), jsonData: { eventType: 11, eventSource: 2 } });
        }
        const onList = this.listLength > 0;
        if (onList && (kind === 'up' || kind === 'down')) {
            this.index = Math.max(0, Math.min(this.listLength - 1, this.index + (kind === 'down' ? 1 : -1)));
            this.listIndex.emit(this.index);
            return;
        }
        if (onList && kind === 'tap') {
            return this.emit({ listEvent: new List_ItemEvent({ containerName: 'llist', currentSelectItemIndex: this.index }) });
        }
        const type = {
            up: OsEventTypeList.SCROLL_TOP_EVENT,
            down: OsEventTypeList.SCROLL_BOTTOM_EVENT,
            tap: undefined,
            double: OsEventTypeList.DOUBLE_CLICK_EVENT,
            hold: OsEventTypeList.LONG_PRESS_EVENT,
            release: OsEventTypeList.LONG_PRESS_RELEASE_EVENT,
        }[kind];
        if (kind === 'up' || kind === 'down')
            this.emit({ textEvent: new Text_ItemEvent({ containerName: 'evt', eventType: type }) });
        else
            this.emit({ sysEvent: new Sys_ItemEvent({ eventType: type, eventSource: 2 }) });
    }
    menu(itemID: number) {
        this.emit({ menuItemClickEvent: { itemID } } as EvenHubEvent);
    }
    private emit(e: EvenHubEvent) {
        for (const fn of this.hub)
            fn(e);
    }
    onEvenHubEvent(cb: (event: EvenHubEvent) => void) {
        this.hub.add(cb);
        return () => this.hub.delete(cb);
    }
    private trackList(page: CreateStartUpPageContainer | RebuildPageContainer) {
        this.listLength = page.listObject?.[0]?.itemContainer?.itemCount ?? 0;
        this.index = 0;
        if (this.listLength)
            this.listIndex.emit(0);
    }
    async createStartUpPageContainer(page: CreateStartUpPageContainer) {
        this.trackList(page);
        return StartUpPageCreateResult.success;
    }
    async rebuildPageContainer(page: RebuildPageContainer) {
        this.trackList(page);
        return true;
    }
    async textContainerUpgrade() {
        return true;
    }
    async updateImageRawData() {
        await new Promise(r => setTimeout(r, 300));
        return ImageRawDataUpdateResult.success;
    }
    async shutDownPageContainer() {
        if (confirm('Exit Universal Translator?')) {
            this.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SYSTEM_EXIT_EVENT }) });
        }
        return true;
    }
    async audioControl(isOpen: boolean, source: AudioInputSource = AudioInputSource.Glasses) {
        if (!isOpen) {
            this.mic?.stream.getTracks().forEach(t => t.stop());
            void this.mic?.ctx.close();
            this.mic = null;
            return true;
        }
        if (this.mic)
            return true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true } });
            const ctx = new AudioContext({ sampleRate: 16000 });
            const node = ctx.createScriptProcessor(2048, 1, 1);
            let acc: number[] = [];
            node.onaudioprocess = ev => {
                const input = ev.inputBuffer.getChannelData(0);
                for (let i = 0; i < input.length; i++)
                    acc.push(input[i]);
                while (acc.length >= 1600) {
                    const frame = acc.slice(0, 1600);
                    acc = acc.slice(1600);
                    const pcm = new Uint8Array(3200);
                    const view = new DataView(pcm.buffer);
                    frame.forEach((s, i) => view.setInt16(i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
                    this.emit({
                        audioEvent: { audioPcm: pcm, source, direction: null, speakerRole: AudioSpeakerRole.Unknown },
                    } as EvenHubEvent);
                }
            };
            ctx.createMediaStreamSource(stream).connect(node);
            node.connect(ctx.destination);
            this.mic = { ctx, stream };
            return true;
        }
        catch (err) {
            void 0;
            return false;
        }
    }
    async setLocalStorage(key: string, value: string) {
        localStorage.setItem(key, value);
        return true;
    }
    async getLocalStorage(key: string) {
        return localStorage.getItem(key) ?? '';
    }
    async getAppLocation(options?: AppLocationOptions): Promise<AppLocation | null> {
        return new Promise(resolve => {
            if (!navigator.geolocation)
                return resolve(null);
            navigator.geolocation.getCurrentPosition(p => resolve(fromPosition(p)), () => resolve(null), { enableHighAccuracy: true, timeout: options?.timeoutMs ?? 8000 });
        });
    }
    async startAppLocationUpdates() {
        if (this.watchId !== null || !navigator.geolocation)
            return true;
        this.watchId = navigator.geolocation.watchPosition(p => {
            const loc = fromPosition(p);
            for (const fn of this.locationListeners)
                fn(loc);
        }, () => { }, { enableHighAccuracy: true });
        return true;
    }
    async stopAppLocationUpdates() {
        if (this.watchId !== null)
            navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
        return true;
    }
    onAppLocationChanged(cb: (l: AppLocation) => void) {
        this.locationListeners.add(cb);
        return () => this.locationListeners.delete(cb);
    }
    onDeviceStatusChanged(_cb: (s: DeviceStatus) => void) {
        return () => { };
    }
    async getDeviceInfo(): Promise<DeviceInfo | null> {
        return null;
    }
}
function fromPosition(p: GeolocationPosition): AppLocation {
    return {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        heading: p.coords.heading ?? undefined,
        speed: p.coords.speed ?? undefined,
        timestamp: p.timestamp,
    };
}
