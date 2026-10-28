import { AudioSpeakerRole } from '@evenrealities/even_hub_sdk';
import { Emitter } from './emitter';
import type { AudioHub } from './audio';
import type { SettingsStore } from './settings';
import { SonioxStream, type SonioxResponse, type SonioxToken } from '../services/soniox';
import { SpeechGate } from './vad';
export interface CommandState {
    mode: 'hold' | 'auto';
    text: string;
}
interface Window {
    start: number;
    end: number | null;
}
interface ActiveCommand {
    mode: 'hold' | 'auto';
    selfOnly: boolean;
    window: Window;
    finals: Map<string, string>;
    tail: string;
    endpointSeen: boolean;
    finSeen: boolean;
}
const SPECIAL = /^<[a-z]+>$/;
const LEAD_MS = 250;
const TRAIL_MS = 300;
const NO_WORDS_MS = 10000;
export class Speech {
    readonly stt = new SonioxStream();
    readonly responses = new Emitter<SonioxResponse>();
    readonly command = new Emitter<CommandState | null>();
    private translating = false;
    private windows: Window[] = [];
    private active: ActiveCommand | null = null;
    readonly gate = new SpeechGate();
    private streaming = false;
    private streamOpenedAt = 0;
    private lastWordAt = 0;
    heardMs = 0;
    streamedMs = 0;
    private streamClockAt = 0;
    constructor(private audio: AudioHub, private settings: SettingsStore) {
        audio.frames.on(frame => {
            const muteSelf = this.settings.get().ignoreOwnVoice && frame.role === AudioSpeakerRole.Self && !this.active;
            const muteOther = this.active?.selfOnly && frame.role !== AudioSpeakerRole.Self;
            const pcm = muteSelf || muteOther ? new Uint8Array(frame.pcm.byteLength) : frame.pcm;
            this.heardMs += pcm.byteLength / 32;
            this.tickStreamClock();
            const wasOpen = this.gate.open;
            this.gate.push(pcm);
            if (this.active || !this.gated) {
                if (this.streaming)
                    this.stt.sendPcm(pcm);
                return;
            }
            if (!this.translating)
                return;
            if (this.gate.open) {
                if (!wasOpen || !this.streaming) {
                    this.openStream();
                    for (const chunk of this.gate.takePreroll())
                        this.stt.sendPcm(chunk);
                }
                else {
                    this.stt.sendPcm(pcm);
                }
                if (Date.now() - Math.max(this.streamOpenedAt, this.lastWordAt) > NO_WORDS_MS) {
                    this.gate.close();
                    this.closeStream();
                }
            }
            else if (this.streaming) {
                this.closeStream();
            }
        });
        this.stt.responses.on(resp => this.onResponse(resp));
        this.stt.state.on(({ state }) => {
            if (state !== 'connecting')
                return;
            this.windows = this.active ? [this.active.window] : [];
            if (this.active)
                this.active.window.start = 0;
        });
        settings.changed.on(() => this.sync());
    }
    get isTranslating() {
        return this.translating;
    }
    get listening() {
        return !!this.active;
    }
    private get gated() {
        return this.settings.get().speechGate;
    }
    setTranslating(on: boolean) {
        this.translating = on;
        if (!on) {
            this.gate.close();
            this.gate.takePreroll();
        }
        this.sync();
    }
    resume() {
        this.audio.rearm();
        this.stt.ensure();
    }
    claims(t: SonioxToken): boolean {
        if (t.translation_status === 'translation')
            return !!this.active;
        const at = t.start_ms;
        if (at === undefined)
            return false;
        return this.windows.some(w => at >= w.start - LEAD_MS && (w.end === null || at <= w.end + TRAIL_MS));
    }
    beginCommand(mode: 'hold' | 'auto', selfOnly = false) {
        if (this.active)
            return;
        this.gate.takePreroll();
        const window: Window = { start: 0, end: null };
        this.active = { mode, selfOnly, window, finals: new Map(), tail: '', endpointSeen: false, finSeen: false };
        this.sync();
        window.start = this.stt.audioMs;
        if (!this.windows.includes(window))
            this.windows.push(window);
        if (this.windows.length > 4)
            this.windows.shift();
        this.command.emit({ mode, text: '' });
    }
    submitCommand() {
        if (this.active)
            this.active.endpointSeen = true;
    }
    async waitForPause(maxMs = 9000): Promise<void> {
        const cmd = this.active;
        const until = Date.now() + maxMs;
        while (cmd && this.active === cmd && !cmd.endpointSeen && Date.now() < until) {
            if (this.stt.current === 'error')
                throw new Error('Speech connection failed. Check the phone settings.');
            await new Promise(r => setTimeout(r, 150));
        }
    }
    async endCommand(): Promise<string> {
        const cmd = this.active;
        if (!cmd)
            return '';
        cmd.window.end = this.stt.audioMs;
        this.stt.finalize();
        const until = Date.now() + 1800;
        while (this.active === cmd && !cmd.finSeen && Date.now() < until)
            await new Promise(r => setTimeout(r, 100));
        if (this.active !== cmd)
            return '';
        const text = commandText(cmd);
        this.active = null;
        this.gate.close();
        this.gate.takePreroll();
        this.sync();
        this.command.emit(null);
        return text;
    }
    cancelCommand() {
        if (!this.active)
            return;
        this.active.window.end = this.stt.audioMs;
        this.active = null;
        this.gate.close();
        this.gate.takePreroll();
        this.sync();
        this.command.emit(null);
    }
    private onResponse(resp: SonioxResponse) {
        if (resp.tokens?.some(t => !SPECIAL.test(t.text) && t.text.trim()))
            this.lastWordAt = Date.now();
        const cmd = this.active;
        if (cmd && resp.tokens) {
            const w = cmd.window;
            let tail = '';
            for (const t of resp.tokens) {
                if (t.text === '<fin>')
                    cmd.finSeen = true;
                if (t.text === '<end>' && t.is_final && cmd.finals.size)
                    cmd.endpointSeen = true;
                if (SPECIAL.test(t.text) || t.translation_status === 'translation' || t.start_ms === undefined)
                    continue;
                if (t.start_ms < w.start - LEAD_MS || (w.end !== null && t.start_ms > w.end + TRAIL_MS))
                    continue;
                if (t.is_final)
                    cmd.finals.set(`${t.start_ms}:${t.text}`, t.text);
                else
                    tail += t.text;
            }
            cmd.tail = tail;
            this.command.emit({ mode: cmd.mode, text: commandText(cmd) });
        }
        this.responses.emit(resp);
    }
    private sync() {
        const s = this.settings.get();
        const need = this.translating || !!this.active;
        this.audio.setSource(this.active?.selfOnly ? 'glasses' : s.micSource);
        if (need) {
            if (s.sonioxKey && !this.audio.on)
                this.audio.start();
            else if (!s.sonioxKey && this.audio.on)
                this.audio.stop();
        }
        else if (this.audio.on) {
            this.audio.stop();
        }
        const stream = !!this.active || (this.translating && (!this.gated || this.gate.open));
        if (stream)
            this.openStream();
        else
            this.closeStream();
    }
    private openStream() {
        const s = this.settings.get();
        if (!this.streaming) {
            this.streaming = true;
            this.streamOpenedAt = Date.now();
            this.streamClockAt = Date.now();
        }
        this.stt.start({
            apiKey: s.sonioxKey,
            languageHints: [...new Set(this.active ? [s.mainLang] : [s.sourceLang, s.mainLang])],
            targetLanguage: this.active ? undefined : s.mainLang,
        });
    }
    private closeStream() {
        this.tickStreamClock();
        this.streaming = false;
        if (this.stt.current !== 'idle')
            this.stt.stop();
    }
    private tickStreamClock() {
        if (!this.streaming)
            return;
        const now = Date.now();
        this.streamedMs += now - this.streamClockAt;
        this.streamClockAt = now;
    }
}
function commandText(cmd: ActiveCommand) {
    return ([...cmd.finals.values()].join('') + cmd.tail).replace(/\s+/g, ' ').trim();
}
