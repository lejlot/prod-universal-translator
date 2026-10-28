import { AudioInputSource, AudioSpeakerRole, type AudioEvent } from '@evenrealities/even_hub_sdk';
import { Emitter } from './emitter';
import type { Host } from './host';
import type { BleQueue } from './queue';
import type { MicSource } from './settings';
export interface PcmFrame {
    pcm: Uint8Array;
    role: AudioSpeakerRole;
}
export class AudioHub {
    readonly frames = new Emitter<PcmFrame>();
    readonly state = new Emitter<boolean>();
    private wanted = false;
    private open = false;
    private source: MicSource = 'glasses';
    private lastFrameAt = 0;
    constructor(private host: Host, private queue: BleQueue) { }
    get on() {
        return this.wanted;
    }
    get isOpen() {
        return this.open;
    }
    push(event: AudioEvent) {
        this.lastFrameAt = Date.now();
        this.frames.emit({ pcm: event.audioPcm, role: event.speakerRole ?? AudioSpeakerRole.Unknown });
    }
    setSource(source: MicSource) {
        if (source === this.source)
            return;
        this.source = source;
        if (this.wanted)
            this.apply(true);
    }
    start() {
        this.wanted = true;
        this.apply(true);
    }
    stop() {
        this.wanted = false;
        this.apply(false);
    }
    rearm() {
        if (this.wanted && Date.now() - this.lastFrameAt > 1500)
            this.apply(true);
    }
    private apply(open: boolean) {
        const src = this.source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses;
        this.queue.enqueue('audio', 'device', async () => {
            if (open && this.open)
                await this.host.audioControl(false);
            const ok = await this.host.audioControl(open, open ? src : undefined);
            this.open = open && ok;
            this.state.emit(this.open);
            if (!ok)
                void 0;
        });
    }
}
