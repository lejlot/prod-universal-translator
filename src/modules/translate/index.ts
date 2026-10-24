import { Emitter } from '../../core/emitter';
import { fitLine, ScrollBox, wrapMax } from '../../core/textbox';
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
    mode: Mode = 'live';
    replies: Reply[] = [];
    notice = '';
    sttState: SttState = 'idle';
    sttDetail = '';
    private lastSpeechAt = 0;
    private speechSeq = 0;
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
    } | null = null;
    private ready: {
        seq: number;
        replies: Reply[];
    } | null = null;
    readonly boxes = { orig: new ScrollBox(), eng: new ScrollBox() };
    constructor(private shell: Shell, private speech: Speech, private claude: ClaudeService, settings: SettingsStore, private store: Store) {
        this.transcript = new Transcript('en', settings.get().sourceLang);
        this.transcript.filter = t => !speech.claims(t);
        speech.responses.on(resp => {
            if (!this.speaking)
                this.transcript.markSegment();
            if (this.transcript.apply(resp)) {
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
        this.speech.setTranslating(false);
    }
    get live() {
        return this.speech.isTranslating;
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
        if (g.kind !== 'hold' && g.kind !== 'pinch')
            return false;
        if (g.kind === 'hold')
            this.holding = true;
        if (Date.now() - this.toggledAt < TOGGLE_DEBOUNCE_MS)
            return true;
        this.toggledAt = Date.now();
        this.setLive(!this.live);
        this.shell.flash(this.live ? 'LIVE' : 'PAUSED');
        return true;
    }
    private swallowRelease(): boolean {
        const was = this.holding;
        this.holding = false;
        return was;
    }
    onGesture(g: Gesture): boolean {
        if (g.kind !== 'tap')
            return false;
        this.tap();
        return true;
    }
    private tap() {
        if (this.mode === 'loading')
            return;
        const stale = this.repliesSeq !== this.speechSeq;
        if (!this.visible && !this.notice) {
            if (this.transcript.isEmpty && !this.replies.length)
                return;
            if (this.mode === 'replies' && !stale)
                return this.showReplies(this.replies, this.repliesSeq);
            this.keepVisible();
            if (this.mode === 'replies')
                return void this.suggestReplies(false);
            return this.refresh();
        }
        if (stale) {
            this.keepVisible();
            return void this.suggestReplies(false);
        }
        if (!this.showingReplies && this.replies.length)
            return this.showReplies(this.replies, this.repliesSeq);
        this.mode = 'live';
        this.keepVisible();
        this.refresh();
    }
    private schedulePrefetch() {
        if (this.prefetchTimer !== null)
            window.clearTimeout(this.prefetchTimer);
        this.prefetchTimer = window.setTimeout(() => {
            this.prefetchTimer = null;
            if (!this.live || !this.claude.configured || this.transcript.isEmpty || this.repliesSeq === this.speechSeq)
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
        const snap = this.transcript.snapshot();
        const replies = this.claude.suggestReplies({
            original: snap.original.slice(-700),
            english: snap.english.slice(-700),
            lang: snap.partnerLang,
        });
        const entry = { seq, replies };
        this.inflight = entry;
        void replies.finally(() => {
            if (this.inflight === entry)
                this.inflight = null;
        }).catch(() => { });
        return replies;
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
        ];
    }
    badge(): string {
        if (this.speech.listening)
            return '';
        if (!this.live)
            return 'PAUSED';
        if (this.sttState === 'error')
            return '! SPEECH';
        return '';
    }
    info(): string {
        return this.live ? `${this.transcript.partnerLang.toUpperCase()}›EN` : '';
    }
    setLive(on: boolean) {
        this.speech.setTranslating(on);
        this.store.save('translate', { paused: !on });
        this.refresh();
        this.shell.invalidate('shell.header');
    }
    clear() {
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
        if (this.mode === 'loading')
            return;
        if (!this.claude.configured)
            return this.flash('Add an Anthropic key in the phone settings to get replies.');
        if (this.transcript.isEmpty)
            return this.flash('Nothing to reply to yet.');
        const seq = this.speechSeq;
        if (!fresh && this.ready?.seq === seq) {
            return this.showReplies(this.ready.replies, seq);
        }
        if (fresh && this.inflight?.seq === seq)
            this.inflight = null;
        this.mode = 'loading';
        this.keepVisible();
        this.refresh();
        try {
            const replies = await this.fetchReplies(seq);
            if (this.mode !== 'loading')
                return;
            this.ready = { seq, replies };
            this.showReplies(replies, seq);
        }
        catch (err) {
            if (this.mode !== 'loading')
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
        if (this.notice)
            return wrapMax(this.notice, width, rows, textWidth).map(bright => ({ bright }));
        if (this.mode === 'loading')
            return [{ bright: '» …' }];
        if (this.showingReplies)
            return replyRows(this.replies.slice(0, rows), width);
        if (this.sttState === 'error')
            return wrapMax(`! ${this.sttDetail || 'Speech service error'}`, width, rows, textWidth).map(dim => ({ dim }));
        return this.box('orig', width, rows).map(dim => ({ dim }));
    }
    englishRows(width: number, rows: number): Row[] {
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
    const said = replies.map(r => fitLine(`» ${r.text}`, width, textWidth));
    const space = textWidth(' ');
    const after = (text: string) => Math.ceil((textWidth(text) + 2 * space) / space);
    const column = Math.max(...said.map(after));
    const roomAt = (at: number) => width - at * space - textWidth('╱ ');
    const aligned = roomAt(column) >= MIN_GLOSS_PX;
    return replies.map((r, i) => {
        const at = aligned ? column : after(said[i]);
        const room = roomAt(at);
        if (room < MIN_GLOSS_PX || !r.english.trim())
            return { bright: said[i] };
        return { bright: said[i], dim: `${' '.repeat(at)}╱ ${fitLine(r.english, room, textWidth)}` };
    });
}
function words(text: string): Set<string> {
    const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return new Set(plain.match(/[\p{L}\p{N}']+/gu) ?? []);
}
