import { Emitter } from '../core/emitter';
export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
export const MODEL = 'stt-rt-v5';
const BYTES_PER_MS = 32;
export interface SonioxToken {
    text: string;
    start_ms?: number;
    end_ms?: number;
    confidence?: number;
    is_final?: boolean;
    language?: string;
    source_language?: string;
    translation_status?: 'none' | 'original' | 'translation';
}
export interface SonioxResponse {
    tokens?: SonioxToken[];
    final_audio_proc_ms?: number;
    total_audio_proc_ms?: number;
    finished?: boolean;
    error_code?: number;
    error_type?: string;
    error_message?: string;
}
export type SttState = 'idle' | 'connecting' | 'live' | 'error';
export interface SttOptions {
    apiKey: string;
    languageHints: string[];
    targetLanguage?: string;
}
export class SonioxStream {
    readonly responses = new Emitter<SonioxResponse>();
    readonly state = new Emitter<{
        state: SttState;
        detail?: string;
    }>();
    private ws: WebSocket | null = null;
    private opts: SttOptions | null = null;
    private backlog: Uint8Array<ArrayBuffer>[] = [];
    private backlogBytes = 0;
    private sentBytes = 0;
    private wantOpen = false;
    private retry = 0;
    private retryTimer: number | null = null;
    private keepalive: number | null = null;
    private lastAudioAt = 0;
    current: SttState = 'idle';
    get audioMs() {
        return (this.sentBytes + this.backlogBytes) / BYTES_PER_MS;
    }
    start(opts: SttOptions) {
        const changed = JSON.stringify(opts) !== JSON.stringify(this.opts);
        this.opts = opts;
        this.wantOpen = true;
        if (!opts.apiKey) {
            this.setState('error', 'Add a Soniox API key in settings');
            return;
        }
        if (changed || !this.ws)
            this.connect();
    }
    stop() {
        this.wantOpen = false;
        this.clearTimers();
        this.backlog = [];
        this.backlogBytes = 0;
        const ws = this.ws;
        this.ws = null;
        if (ws?.readyState === WebSocket.OPEN)
            ws.send('');
        else
            ws?.close();
        this.setState('idle');
    }
    ensure() {
        if (this.wantOpen && this.opts?.apiKey && (!this.ws || this.ws.readyState > WebSocket.OPEN))
            this.connect();
    }
    sendPcm(pcm: Uint8Array) {
        const chunk = pcm as Uint8Array<ArrayBuffer>;
        this.lastAudioAt = Date.now();
        const ws = this.ws;
        if (ws && ws.readyState === WebSocket.OPEN && this.backlog.length === 0) {
            ws.send(chunk);
            this.sentBytes += chunk.byteLength;
            return;
        }
        this.backlog.push(chunk);
        this.backlogBytes += chunk.byteLength;
        while (this.backlogBytes > 5000 * BYTES_PER_MS)
            this.backlogBytes -= this.backlog.shift()!.byteLength;
    }
    finalize() {
        if (this.ws?.readyState === WebSocket.OPEN)
            this.ws.send(JSON.stringify({ type: 'finalize' }));
    }
    private connect() {
        const opts = this.opts!;
        this.ws?.close();
        this.clearTimers();
        this.setState('connecting');
        this.sentBytes = 0;
        let ws: WebSocket;
        try {
            ws = new WebSocket(SONIOX_URL, ['soniox-api-key', opts.apiKey]);
        }
        catch (err) {
            this.setState('error', String(err));
            this.scheduleRetry();
            return;
        }
        ws.binaryType = 'arraybuffer';
        this.ws = ws;
        ws.onopen = () => {
            if (this.ws !== ws) {
                ws.close();
                return;
            }
            ws.send(JSON.stringify({
                model: MODEL,
                audio_format: 'pcm_s16le',
                sample_rate: 16000,
                num_channels: 1,
                language_hints: opts.languageHints,
                enable_language_identification: true,
                enable_endpoint_detection: true,
                max_endpoint_delay_ms: 1500,
                ...(opts.targetLanguage ? { translation: { type: 'one_way', target_language: opts.targetLanguage } } : {}),
                client_reference_id: 'universal-translator',
            }));
            this.retry = 0;
            this.setState('live');
            for (const chunk of this.backlog) {
                ws.send(chunk);
                this.sentBytes += chunk.byteLength;
            }
            this.backlog = [];
            this.backlogBytes = 0;
            this.keepalive = window.setInterval(() => {
                if (ws.readyState === WebSocket.OPEN && Date.now() - this.lastAudioAt > 10000) {
                    ws.send(JSON.stringify({ type: 'keepalive' }));
                }
            }, 10000);
        };
        ws.onmessage = ev => {
            if (this.ws !== ws)
                return;
            if (typeof ev.data !== 'string')
                return;
            let msg: SonioxResponse;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            if (msg.error_code || msg.error_message) {
                this.setState('error', `${msg.error_code ?? ''} ${msg.error_message ?? ''}`.trim());
                if (msg.error_code === 401 || msg.error_code === 402 || msg.error_code === 403)
                    this.wantOpen = false;
                return;
            }
            this.responses.emit(msg);
        };
        ws.onclose = ev => {
            if (this.ws !== ws)
                return;
            this.ws = null;
            this.clearTimers();
            if (!this.wantOpen)
                return this.setState('idle');
            if (this.current !== 'error')
                this.setState('connecting', `closed (${ev.code})`);
            this.scheduleRetry();
        };
        ws.onerror = () => {
            if (this.ws === ws)
                this.setState('error', 'connection error');
        };
    }
    private scheduleRetry() {
        if (!this.wantOpen || this.retryTimer !== null)
            return;
        const delay = Math.min(15000, 500 * 2 ** this.retry++);
        this.retryTimer = window.setTimeout(() => {
            this.retryTimer = null;
            if (this.wantOpen)
                this.connect();
        }, delay);
    }
    private clearTimers() {
        if (this.keepalive !== null)
            window.clearInterval(this.keepalive);
        if (this.retryTimer !== null)
            window.clearTimeout(this.retryTimer);
        this.keepalive = null;
        this.retryTimer = null;
    }
    private setState(state: SttState, detail?: string) {
        this.current = state;
        this.state.emit({ state, detail });
    }
}
