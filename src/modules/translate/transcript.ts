import type { SonioxResponse, SonioxToken } from '../../services/soniox';
const MAX_CHARS = 6000;
const KEEP_CHARS = 4000;
export interface TranscriptSnapshot {
    original: string;
    english: string;
    lang: string;
    partnerLang: string;
}
export interface Utterance {
    orig: string;
    eng: string;
}
interface Utt extends Utterance {
    ended: boolean;
}
const MAX_UTTERANCES = 60;
export class Transcript {
    private utts: Utt[] = [{ orig: '', eng: '', ended: false }];
    private cur = 0;
    private engAt = 0;
    private segUtt = 0;
    private uttOrigTail = '';
    private uttEngTail = '';
    private origFinal = '';
    private engFinal = '';
    private origTail = '';
    private engTail = '';
    private breakOrig = false;
    private breakEng = false;
    private segOrig = 0;
    private segEng = 0;
    lang: string;
    partnerLang: string;
    lastFinalAt = 0;
    constructor(private targetLang = 'en', defaultSource = 'es') {
        this.lang = defaultSource;
        this.partnerLang = defaultSource;
    }
    configure(targetLang: string, defaultSource: string) {
        this.clear();
        this.targetLang = targetLang;
        this.lang = this.partnerLang = defaultSource;
    }
    filter: (t: SonioxToken) => boolean = () => true;
    apply(resp: SonioxResponse): boolean {
        const tokens = resp.tokens ?? [];
        if (!tokens.length)
            return false;
        const before = this.signature();
        let origTail = '';
        let engTail = '';
        let uttOrigTail = '';
        let uttEngTail = '';
        for (const t of tokens) {
            if (t.text === '<fin>')
                continue;
            if (t.text === '<end>') {
                if (t.is_final) {
                    this.breakOrig = true;
                    this.breakEng = true;
                    this.endUtterance();
                }
                continue;
            }
            if (!this.filter(t))
                continue;
            const spoken = (t.translation_status ?? 'none') !== 'translation';
            if (spoken && t.language) {
                this.lang = t.language;
                if (t.language !== this.targetLang)
                    this.partnerLang = t.language;
            }
            if (spoken && t.language === this.targetLang)
                continue;
            if (t.is_final) {
                if (spoken) {
                    this.origFinal = this.appendWithBreak(this.origFinal, t.text, 'orig');
                    this.addTo(this.utts[this.cur], 'orig', t.text);
                }
                else {
                    this.engFinal = this.appendWithBreak(this.engFinal, t.text, 'eng');
                    this.addTo(this.translationTarget(true), 'eng', t.text);
                }
                this.lastFinalAt = Date.now();
            }
            else if (spoken) {
                origTail += t.text;
                uttOrigTail += t.text;
            }
            else {
                engTail += t.text;
                uttEngTail += t.text;
            }
        }
        this.origTail = origTail;
        this.engTail = engTail;
        this.uttOrigTail = uttOrigTail;
        this.uttEngTail = uttEngTail;
        this.trim();
        return before !== this.signature();
    }
    private signature() {
        return `${this.origFinal.length}|${this.engFinal.length}|${this.origTail}|${this.engTail}|${this.breakOrig}|${this.utts.length}`;
    }
    private addTo(u: Utt, side: 'orig' | 'eng', text: string) {
        u[side] = u[side] ? u[side] + text : text.trimStart();
    }
    private endUtterance() {
        const u = this.utts[this.cur];
        if (!u.orig.trim() && !u.eng.trim())
            return;
        u.ended = true;
        this.utts.push({ orig: '', eng: '', ended: false });
        this.cur++;
        if (this.utts.length > MAX_UTTERANCES) {
            const drop = this.utts.length - MAX_UTTERANCES;
            this.utts.splice(0, drop);
            this.cur -= drop;
            this.engAt = Math.max(0, this.engAt - drop);
            this.segUtt = Math.max(0, this.segUtt - drop);
        }
    }
    private translationTarget(commit: boolean): Utt {
        let i = this.engAt;
        while (i < this.cur && (translated(this.utts[i]) || (i < this.cur - 1 && !!this.utts[i].eng)))
            i++;
        if (commit)
            this.engAt = i;
        return this.utts[i];
    }
    get recentPairs(): Utterance[] {
        const tailTarget = this.translationTarget(false);
        return this.utts
            .slice(this.segUtt)
            .map((u, k) => {
            const i = this.segUtt + k;
            let orig = u.orig;
            let eng = u.eng;
            if (i === this.cur)
                orig = joinTail(orig, this.uttOrigTail, false);
            if (u === tailTarget)
                eng = joinTail(eng, this.uttEngTail, false);
            return { orig: orig.trim(), eng: eng.trim() };
        })
            .filter(p => p.orig || p.eng);
    }
    private appendWithBreak(stream: string, text: string, which: 'orig' | 'eng'): string {
        if (!stream.length)
            return text.trimStart();
        const pending = which === 'orig' ? this.breakOrig : this.breakEng;
        const ready = which === 'orig' || /[.!?…。？！]["')\]]?\s*$/.test(stream);
        if (pending && ready) {
            if (which === 'orig')
                this.breakOrig = false;
            else
                this.breakEng = false;
            return stream.trimEnd() + '\n' + text.trimStart();
        }
        return stream + text;
    }
    private trim() {
        if (this.origFinal.length > MAX_CHARS) {
            const before = this.origFinal.length;
            this.origFinal = cutToLine(this.origFinal, KEEP_CHARS);
            this.segOrig = Math.max(0, this.segOrig - (before - this.origFinal.length));
        }
        if (this.engFinal.length > MAX_CHARS) {
            const before = this.engFinal.length;
            this.engFinal = cutToLine(this.engFinal, KEEP_CHARS);
            this.segEng = Math.max(0, this.segEng - (before - this.engFinal.length));
        }
    }
    markSegment() {
        this.segOrig = this.origFinal.length;
        this.segEng = this.engFinal.length;
        this.segUtt = this.cur;
    }
    get recentOriginal() {
        return joinTail(this.origFinal.slice(this.segOrig), this.origTail, false).trimStart();
    }
    get recentEnglish() {
        return joinTail(this.engFinal.slice(this.segEng), this.engTail, false).trimStart();
    }
    get original() {
        return joinTail(this.origFinal, this.origTail, this.breakOrig);
    }
    get english() {
        return joinTail(this.engFinal, this.engTail, false);
    }
    snapshot(): TranscriptSnapshot {
        return { original: this.original, english: this.english, lang: this.lang, partnerLang: this.partnerLang };
    }
    dump() {
        return { o: this.origFinal.slice(-1500), e: this.engFinal.slice(-1500), l: this.lang, p: this.partnerLang, target: this.targetLang };
    }
    restore(d: {
        o?: string;
        e?: string;
        l?: string;
        p?: string;
        target?: string;
    }) {
        if ((d.target ?? 'en') !== this.targetLang)
            return;
        this.origFinal = d.o ?? '';
        this.engFinal = d.e ?? '';
        const o = this.origFinal.split('\n');
        const e = this.engFinal.split('\n');
        this.utts = Array.from({ length: Math.max(o.length, e.length) }, (_, i) => ({ orig: o[i] ?? '', eng: e[i] ?? '', ended: true }));
        this.utts.push({ orig: '', eng: '', ended: false });
        this.cur = this.engAt = this.utts.length - 1;
        this.segUtt = 0;
        this.lang = d.l || this.lang;
        this.partnerLang = d.p || this.partnerLang;
        if (this.origFinal)
            this.breakOrig = true;
        if (this.engFinal)
            this.breakEng = true;
    }
    clear() {
        this.utts = [{ orig: '', eng: '', ended: false }];
        this.cur = this.engAt = this.segUtt = 0;
        this.uttOrigTail = this.uttEngTail = '';
        this.origFinal = this.engFinal = this.origTail = this.engTail = '';
        this.segOrig = this.segEng = 0;
        this.breakOrig = this.breakEng = false;
    }
    get isEmpty() {
        return !this.original.trim() && !this.english.trim();
    }
}
function translated(u: Utt): boolean {
    if (!u.ended)
        return false;
    if (!u.orig)
        return true;
    if (!u.eng)
        return false;
    const sentence = /[.!?…。？！]["')\]]?\s*$/.test(u.eng);
    return sentence && u.eng.length >= 0.5 * u.orig.length;
}
function joinTail(final: string, tail: string, breakPending: boolean): string {
    if (!tail)
        return final;
    if (!final)
        return tail.trimStart();
    if (breakPending)
        return final.trimEnd() + '\n' + tail.trimStart();
    return final + tail;
}
function cutToLine(s: string, keep: number): string {
    const cut = s.slice(-keep);
    const nl = cut.indexOf('\n');
    return nl >= 0 && nl < 400 ? cut.slice(nl + 1) : cut;
}
