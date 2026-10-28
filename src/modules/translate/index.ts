import { Emitter } from '../../core/emitter';
import { ReadingBox, ScrollBox, wrap } from '../../core/textbox';
import type { SettingsStore } from '../../core/settings';
import type { Shell } from '../../core/shell';
import type { Speech } from '../../core/speech';
import type { Store } from '../../core/store';
import { textWidth } from '../../core/textfit';
import type { Action, Gesture, HudModule } from '../../core/types';
import type { ClaudeService, Reply } from '../../services/claude';
import type { SttState } from '../../services/soniox';
import type { Row } from '../../views';
import { Transcript } from './transcript';
import { VoiceSession } from './voice';
type Mode = 'live' | 'loading' | 'replies';
const SILENCE_MS = 20000;
const REPLIES_MS = 20000;
const TOGGLE_DEBOUNCE_MS = 800;
const PREFETCH_AFTER_MS = 1200;
const MIN_GLOSS_PX = 60;
export class TranslateModule implements HudModule {
    readonly id = 'translate';
    readonly title = 'Translate';
    readonly changed = new Emitter();
    readonly transcript: Transcript;
    readonly voice: VoiceSession;
    mode: Mode = 'live';
    replies: Reply[] = [];
    notice = '';
    sttState: SttState = 'idle';
    sttDetail = '';
    private lastSpeechAt = 0;
    private speechSeq = 0;
    private replyRequest = 0;
    private repliesSeq = -1;
    private visibleUntil = 0;
    private hideTimer: number | null = null;
    private repliesUntil = 0;
    private repliesTimer: number | null = null;
    private toggledAt = 0;
    private holding = false;
    private prefetchTimer: number | null = null;
    private inflight: {
        seq: number;
        replies: Promise<Reply[]>;
        abort: AbortController;
    } | null = null;
    private ready: {
        seq: number;
        replies: Reply[];
    } | null = null;
    readonly boxes = { orig: new ScrollBox(), eng: new ScrollBox() };
    private reading = { top: new ReadingBox<Row>(), answer: new ReadingBox<Row>() };
    constructor(private shell: Shell, private speech: Speech, private claude: ClaudeService, private settings: SettingsStore, private store: Store, context: () => Promise<string> = async () => 'Location unavailable') {
        this.transcript = new Transcript(settings.get().mainLang, settings.get().sourceLang);
        this.transcript.filter = t => !speech.claims(t);
        this.voice = new VoiceSession(speech, claude, settings, context);
        this.voice.changed.on(() => { this.refresh(); this.shell.invalidate('shell.header'); });
        let languages = `${settings.get().mainLang}:${settings.get().sourceLang}`;
        let shareLocation = settings.get().shareLocation;
        settings.changed.on(s => {
            if (shareLocation !== s.shareLocation) {
                shareLocation = s.shareLocation;
                if (this.voice.kind === 'chat')
                    this.setLive(false);
            }
            const next = `${s.mainLang}:${s.sourceLang}`;
            if (next === languages)
                return;
            const wasLive = this.live;
            languages = next;
            this.voice.stop();
            this.transcript.configure(s.mainLang, s.sourceLang);
            this.clear();
            this.setLive(wasLive);
        });
        speech.responses.on(resp => {
            if (!this.live || (this.voice.kind && this.voice.phase !== 'result' && this.voice.phase !== 'error'))
                return;
            if (!this.speaking)
                this.transcript.markSegment();
            if (this.transcript.apply(resp)) {
                if (this.voice.kind === 'reverse' && this.voice.phase === 'result')
                    this.voice.stop();
                this.lastSpeechAt = Date.now();
                this.speechSeq++;
                if (this.showingReplies && this.saidAReply())
                    this.mode = 'live';
                this.keepVisible();
                this.schedulePrefetch();
                this.refresh();
                this.store.save('transcript', this.transcript.dump(), 15000);
            }
        });
        speech.stt.state.on(({ state, detail }) => {
            this.sttState = state;
            this.sttDetail = detail ?? '';
            this.refresh();
            this.shell.invalidate('shell.header');
        });
    }
    async start() {
        this.transcript.restore(await this.store.load('transcript', {}));
        const saved = await this.store.load('translate', { paused: false });
        this.speech.setTranslating(!saved.paused);
        this.refresh();
    }
    resume() {
        this.speech.resume();
    }
    stop() {
        this.replyRequest++;
        this.cancelReplies();
        this.voice.stop();
        this.speech.setTranslating(false);
        if (this.prefetchTimer !== null)
            window.clearTimeout(this.prefetchTimer);
        if (this.hideTimer !== null)
            window.clearTimeout(this.hideTimer);
        if (this.repliesTimer !== null)
            window.clearTimeout(this.repliesTimer);
        this.speechSeq++;
        this.mode = 'live';
    }
    get live() {
        return this.voice.kind === 'reverse' || this.speech.isTranslating;
    }
    get speaking() {
        return Date.now() - this.lastSpeechAt < SILENCE_MS;
    }
    get visible() {
        return Date.now() < this.visibleUntil;
    }
    get showingReplies() {
        return this.mode === 'replies' && this.visible && this.replies.length > 0 && Date.now() < this.repliesUntil;
    }
    private showReplies(replies: Reply[], seq: number) {
        this.replies = replies;
        this.repliesSeq = seq;
        this.mode = 'replies';
        this.repliesUntil = Date.now() + REPLIES_MS;
        if (this.repliesTimer !== null)
            window.clearTimeout(this.repliesTimer);
        this.repliesTimer = window.setTimeout(() => {
            this.repliesTimer = null;
            this.refresh();
        }, REPLIES_MS + 50);
        this.keepVisible();
        this.refresh();
    }
    private saidAReply(): boolean {
        const said = words(this.transcript.recentPairs.at(-1)?.orig ?? '');
        if (!said.size)
            return false;
        return this.replies.some(r => {
            const reply = [...words(r.text)];
            if (!reply.length)
                return false;
            return reply.filter(w => said.has(w)).length / reply.length >= 0.6;
        });
    }
    private keepVisible() {
        this.visibleUntil = Date.now() + SILENCE_MS;
        if (this.hideTimer !== null)
            window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => {
            this.hideTimer = null;
            this.refresh();
        }, SILENCE_MS + 50);
    }
    onShortcut(g: Gesture): boolean {
        if (g.kind === 'release')
            return this.swallowRelease();
        if (g.kind === 'double') {
            if (this.voice.kind === 'chat') {
                this.setLive(false);
                this.shell.exit();
            }
            else if (this.live)
                this.setLive(false);
            else
                this.shell.exit();
            return true;
        }
        if (g.kind !== 'hold' && g.kind !== 'pinch')
            return false;
        if (g.kind === 'hold')
            this.holding = true;
        if (Date.now() - this.toggledAt < TOGGLE_DEBOUNCE_MS)
            return true;
        this.toggledAt = Date.now();
        this.startVoice();
        return true;
    }
    private swallowRelease(): boolean {
        const was = this.holding;
        this.holding = false;
        return was;
    }
    onGesture(g: Gesture): boolean {
        if (g.kind === 'up' || g.kind === 'down') {
            const delta = g.kind === 'up' ? -1 : 1;
            if (this.voice.kind) {
                this.reading.top.scroll(delta);
                this.reading.answer.scroll(delta);
            }
            else {
                if (this.showingReplies || this.notice || this.sttState === 'error')
                    this.reading.top.scroll(delta);
                else
                    this.boxes.orig.scroll(delta);
                this.boxes.eng.scroll(delta);
                if (this.showingReplies)
                    this.repliesUntil = Date.now() + REPLIES_MS;
                this.keepVisible();
            }
            this.refresh();
            return true;
        }
        if (g.kind !== 'tap')
            return false;
        if (this.voice.kind && this.voice.phase === 'listening')
            this.voice.confirm();
        else if (this.voice.kind && this.voice.phase === 'thinking')
            return true;
        else if (this.voice.kind && this.voice.phase === 'error')
            this.startVoice();
        else if (this.voice.kind === 'chat')
            this.startVoice();
        else if (this.voice.kind === 'reverse') {
            this.voice.stop();
            this.speech.setTranslating(true);
            this.refresh();
        }
        else if (!this.live)
            this.setLive(true);
        else {
            this.tap();
        }
        return true;
    }
    startVoice() {
        if (this.voice.kind && this.voice.phase === 'listening')
            return;
        if (!this.settings.get().sonioxKey || !this.claude.configured)
            return this.flash('Add Soniox and Anthropic keys in phone settings for voice input.');
        const kind = this.voice.kind ?? (this.live ? 'reverse' : 'chat');
        this.mode = 'live';
        this.replyRequest++;
        this.cancelReplies();
        this.notice = '';
        this.speechSeq++;
        this.ready = null;
        if (this.prefetchTimer !== null)
            window.clearTimeout(this.prefetchTimer);
        void this.voice.start(kind, this.transcript.partnerLang, kind === 'chat');
    }
    private tap() {
        if (this.mode === 'loading')
            return;
        this.keepVisible();
        void this.suggestReplies(false);
    }
    private schedulePrefetch() {
        if (this.prefetchTimer !== null)
            window.clearTimeout(this.prefetchTimer);
        this.prefetchTimer = window.setTimeout(() => {
            this.prefetchTimer = null;
            if (!this.live || this.voice.kind || !this.claude.configured || this.transcript.isEmpty || this.repliesSeq === this.speechSeq)
                return;
            const seq = this.speechSeq;
            this.fetchReplies(seq)
                .then(replies => {
                if (seq !== this.speechSeq)
                    return;
                this.ready = { seq, replies };
                if (this.showingReplies)
                    return;
                this.replies = replies;
                this.repliesSeq = seq;
                this.changed.emit();
            })
                .catch(() => { });
        }, PREFETCH_AFTER_MS);
    }
    private fetchReplies(seq: number): Promise<Reply[]> {
        if (this.inflight?.seq === seq)
            return this.inflight.replies;
        this.cancelReplies();
        const abort = new AbortController();
        const snap = this.transcript.snapshot();
        const replies = this.claude.suggestReplies({
            original: snap.original.slice(-700),
            english: snap.english.slice(-700),
            lang: snap.partnerLang,
            mainLang: this.settings.get().mainLang,
        }, abort.signal);
        const entry = { seq, replies, abort };
        this.inflight = entry;
        void replies.finally(() => {
            if (this.inflight === entry)
                this.inflight = null;
        }).catch(() => { });
        return replies;
    }
    private cancelReplies() {
        this.inflight?.abort.abort();
        this.inflight = null;
    }
    actions(): Action[] {
        return [
            { id: 'tr.replies', label: 'Suggest replies', menuLabel: 'Suggest replies', inMenu: true, run: () => this.suggestReplies() },
            {
                id: 'tr.toggle',
                label: this.live ? 'Pause translation' : 'Resume translation',
                menuLabel: 'Pause / resume',
                inMenu: true,
                run: () => this.setLive(!this.live),
            },
            { id: 'tr.clear', label: 'Clear transcript', menuLabel: 'Clear transcript', inMenu: true, run: () => this.clear() },
            { id: 'tr.voice', label: 'Voice input', menuLabel: 'Voice input', inMenu: true, run: () => this.startVoice() },
        ];
    }
    badge(): string {
        if (this.voice.kind)
            return this.voice.phase === 'error' ? '! VOICE' : this.voice.phase === 'thinking' ? 'THINKING' : this.voice.kind === 'chat' ? 'CLAUDE' : this.voice.phase === 'result' ? 'SAY' : 'SPEAK';
        if (this.speech.listening)
            return '';
        if (!this.live)
            return 'PAUSED';
        if (this.sttState === 'error')
            return '! SPEECH';
        return '';
    }
    info(): string {
        const main = this.settings.get().mainLang.toUpperCase();
        const partner = this.transcript.partnerLang.toUpperCase();
        return this.voice.kind === 'reverse' ? `${main}›${partner}` : this.live ? `${partner}›${main}` : '';
    }
    setLive(on: boolean) {
        this.replyRequest++;
        this.cancelReplies();
        this.voice.stop();
        this.mode = 'live';
        this.speechSeq++;
        this.ready = null;
        this.notice = '';
        if (this.prefetchTimer !== null)
            window.clearTimeout(this.prefetchTimer);
        this.speech.setTranslating(on);
        this.store.save('translate', { paused: !on });
        this.refresh();
        this.shell.invalidate('shell.header');
    }
    clear() {
        this.replyRequest++;
        this.cancelReplies();
        const wasLive = this.live;
        this.voice.stop();
        this.speech.setTranslating(wasLive);
        this.transcript.clear();
        this.boxes.orig.reset();
        this.boxes.eng.reset();
        this.replies = [];
        this.ready = null;
        this.speechSeq++;
        this.store.save('transcript', this.transcript.dump(), 0);
        this.backToLive();
    }
    backToLive() {
        this.mode = 'live';
        this.notice = '';
        this.refresh();
    }
    async suggestReplies(fresh = true) {
        if (!this.live || this.voice.kind)
            return;
        if (this.mode === 'loading')
            return;
        if (!this.claude.configured)
            return this.flash('Add an Anthropic key in the phone settings to get replies.');
        if (this.transcript.isEmpty)
            return this.flash('Nothing to reply to yet.');
        const seq = this.speechSeq;
        const request = ++this.replyRequest;
        if (!fresh && this.ready?.seq === seq) {
            return this.showReplies(this.ready.replies, seq);
        }
        if (fresh && this.inflight?.seq === seq)
            this.cancelReplies();
        this.mode = 'loading';
        this.keepVisible();
        this.refresh();
        try {
            const replies = await this.fetchReplies(seq);
            if (request !== this.replyRequest)
                return;
            if (this.mode !== 'loading' || seq !== this.speechSeq) {
                if (this.mode === 'loading') {
                    this.mode = 'live';
                    this.refresh();
                }
                return;
            }
            this.ready = { seq, replies };
            this.showReplies(replies, seq);
        }
        catch (err) {
            if (this.mode !== 'loading' || request !== this.replyRequest)
                return;
            this.mode = 'live';
            this.flash(`Replies failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    private flash(msg: string) {
        this.notice = msg;
        this.refresh();
        window.setTimeout(() => {
            if (this.notice === msg) {
                this.notice = '';
                this.refresh();
            }
        }, 4000);
    }
    private refresh() {
        this.changed.emit();
    }
    topRows(width: number, rows: number): Row[] {
        const read = (text: string, layer: 'dim' | 'bright') => this.reading.top.lines(text, wrap(text, width, textWidth).map(l => ({ [layer]: l.text })), rows);
        if (this.voice.kind)
            return read(this.voice.error || this.voice.heard || (this.voice.phase === 'thinking' ? 'Thinking…' : 'Speak now…'), 'dim');
        if (this.notice)
            return read(this.notice, 'bright');
        if (this.mode === 'loading')
            return [{ bright: '» …' }];
        if (this.showingReplies)
            return this.reading.top.lines(JSON.stringify(this.replies), replyRows(this.replies, width), rows);
        if (this.sttState === 'error')
            return read(`! ${this.sttDetail || 'Speech service error'}`, 'dim');
        return this.box('orig', width, rows).map(dim => ({ dim }));
    }
    englishRows(width: number, rows: number): Row[] {
        if (this.voice.kind) {
            const text = this.voice.answer || (this.voice.phase === 'thinking' ? '…' : '');
            return this.reading.answer.lines(`${this.voice.answerVersion}:${text}`, wrap(text, width, textWidth).map(l => ({ bright: l.text })), rows);
        }
        return this.box('eng', width, rows).map(bright => ({ bright }));
    }
    box(which: 'orig' | 'eng', width: number, rows: number): string[] {
        if (!this.visible)
            return [];
        const said = which === 'orig' ? this.transcript.recentOriginal : this.transcript.recentEnglish;
        const text = said.replace(/\s*\n\s*/g, ' ');
        if (!text.trim())
            return [];
        return this.boxes[which].lines(text, width, rows, textWidth);
    }
}
function replyRows(replies: Reply[], width: number): Row[] {
    const said = replies.map(r => `» ${r.text}`);
    const space = textWidth(' ');
    const after = (text: string) => Math.ceil((textWidth(text) + 2 * space) / space);
    const column = Math.max(...said.map(after));
    const roomAt = (at: number) => width - at * space - textWidth('╱ ');
    const aligned = roomAt(column) >= MIN_GLOSS_PX;
    return replies.flatMap((r, i): Row[] => {
        const at = aligned ? column : after(said[i]);
        const room = roomAt(at);
        if (textWidth(said[i]) <= width && room >= MIN_GLOSS_PX && textWidth(r.english) <= room) {
            return [{ bright: said[i], ...(r.english.trim() ? { dim: `${' '.repeat(at)}╱ ${r.english}` } : {}) }];
        }
        return [
            ...wrap(said[i], width, textWidth).map(l => ({ bright: l.text })),
            ...wrap(r.english.trim() ? `╱ ${r.english}` : '', width, textWidth).map(l => ({ dim: l.text })),
        ];
    });
}
function words(text: string): Set<string> {
    const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return new Set(plain.match(/[\p{L}\p{N}']+/gu) ?? []);
}
