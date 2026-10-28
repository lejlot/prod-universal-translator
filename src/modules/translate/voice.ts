import { Emitter } from '../../core/emitter';
import type { SettingsStore } from '../../core/settings';
import type { Speech } from '../../core/speech';
import type { ClaudeService, ChatTurn } from '../../services/claude';
import { IncompleteAnswerError } from '../../services/claude';
export type VoiceKind = 'reverse' | 'chat';
export class VoiceSession {
    readonly changed = new Emitter();
    kind: VoiceKind | null = null;
    phase: 'listening' | 'thinking' | 'result' | 'error' = 'listening';
    heard = '';
    answer = '';
    answerVersion = 0;
    error = '';
    turns: ChatTurn[] = [];
    private abort: AbortController | null = null;
    constructor(private speech: Speech, private claude: ClaudeService, private settings: SettingsStore, private context: () => Promise<string>) {
        speech.command.on(state => {
            if (!this.kind || !state)
                return;
            this.heard = state.text;
            this.changed.emit();
        });
    }
    confirm() {
        if (this.phase === 'listening')
            this.speech.submitCommand();
    }
    async start(kind: VoiceKind, partnerLang: string, preserve = false) {
        if (preserve && this.kind === kind && this.phase === 'listening')
            return;
        const history = preserve && this.kind === kind ? this.turns : [];
        const previousAnswer = preserve && this.kind === kind ? this.answer : '';
        this.stop();
        const abort = this.abort = new AbortController();
        this.kind = kind;
        this.error = this.answer = this.heard = '';
        this.turns = history;
        this.answer = previousAnswer;
        this.phase = 'listening';
        this.speech.setTranslating(false);
        this.changed.emit();
        const mainLang = this.settings.get().mainLang;
        try {
            do {
                this.phase = 'listening';
                this.heard = '';
                const context = kind === 'chat' ? this.context().catch(() => 'Location unavailable') : Promise.resolve('');
                this.speech.beginCommand('auto', kind === 'chat');
                this.changed.emit();
                await this.speech.waitForPause(30000);
                if (abort.signal.aborted)
                    return;
                const text = await this.speech.endCommand();
                if (abort.signal.aborted)
                    return;
                if (!text) {
                    if (kind === 'chat')
                        continue;
                    this.error = 'No speech heard. Long-press to try again.';
                    this.phase = 'error';
                    break;
                }
                this.heard = text;
                this.phase = 'thinking';
                this.changed.emit();
                if (kind === 'reverse') {
                    const answer = await this.claude.translateSpoken(text, mainLang, partnerLang, abort.signal);
                    if (abort.signal.aborted)
                        return;
                    this.answer = answer;
                }
                else {
                    const turns: ChatTurn[] = [...this.turns, { role: 'user', content: text }];
                    const deviceContext = await context;
                    if (abort.signal.aborted)
                        return;
                    const answer = await this.claude.converse(turns, mainLang, `${deviceContext}\nMain language: ${mainLang}. Speaker language: ${partnerLang}.`, abort.signal);
                    if (abort.signal.aborted)
                        return;
                    this.answer = answer;
                    this.turns = [...turns, { role: 'assistant', content: answer }];
                }
                if (abort.signal.aborted)
                    return;
                this.answerVersion++;
                this.phase = 'result';
                this.changed.emit();
            } while (kind === 'chat' && !abort.signal.aborted);
        }
        catch (error) {
            if (abort.signal.aborted)
                return;
            this.error = error instanceof IncompleteAnswerError ? error.message : 'Voice request failed. Check connection, keys and credit on the phone. Click or press to listen again; double-click to stop.';
            this.phase = 'error';
        }
        finally {
            if (!abort.signal.aborted) {
                this.speech.cancelCommand();
                if (kind === 'reverse')
                    this.speech.setTranslating(true);
                this.changed.emit();
            }
        }
    }
    stop() {
        this.abort?.abort();
        this.abort = null;
        if (this.kind)
            this.speech.cancelCommand();
        this.kind = null;
        this.heard = this.answer = this.error = '';
        this.turns = [];
        this.changed.emit();
    }
}
