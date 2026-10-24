import './style.css';
import type { AudioHub } from '../core/audio';
import type { Settings, SettingsStore } from '../core/settings';
import type { MirrorEvent, Shell } from '../core/shell';
import type { Speech } from '../core/speech';
import type { GestureKind } from '../core/types';
import type { Balance } from '../core/balance';
import type { BrowserHost } from '../browser/host';
import { checkAnthropic, checkSoniox, checkSonioxOrg, type KeyCheck } from '../services/keycheck';
import type { TranslateModule } from '../modules/translate';
export interface PhoneDeps {
    shell: Shell;
    translate: TranslateModule;
    settings: SettingsStore;
    speech: Speech;
    audio: AudioHub;
    balance: Balance;
    mock: BrowserHost | null;
}
type Attrs = Record<string, string | boolean | ((e: Event) => void)>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (typeof v === 'function')
            el.addEventListener(k.replace(/^on/, ''), v);
        else if (typeof v === 'boolean') {
            if (v)
                el.setAttribute(k, '');
        }
        else
            el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
}
export function mountShell(): HTMLElement {
    const main = h('main', {}, h('div', { class: 'top' }, h('h1', {}, 'Universal Translator'), h('div', { class: 'chips', id: 'chips' }, 'Starting…')));
    document.querySelector('#app')!.replaceChildren(main);
    return main;
}
export function mountPhoneUi(main: HTMLElement, d: PhoneDeps) {
    const chips = main.querySelector('#chips') as HTMLElement;
    main.append(mirrorCard(d), translateCard(d), settingsCard(d));
    const renderChips = () => {
        const s = d.settings.get();
        const stt = d.speech.stt.current;
        const items: [
            string,
            string
        ][] = [
            [d.mock ? 'warn' : 'ok', d.mock ? 'Browser preview' : 'Glasses'],
            d.audio.isOpen ? ['ok', 'Mic live'] : d.audio.on ? ['err', 'Mic blocked'] : ['', 'Mic off'],
            [stt === 'live' ? 'ok' : stt === 'error' ? 'err' : stt === 'connecting' ? 'warn' : '', stt === 'idle' && d.translate.live ? 'Speech standby' : `Speech ${stt}`],
            [s.anthropicKey ? 'ok' : 'err', s.anthropicKey ? 'Claude' : 'Claude: no key'],
        ];
        chips.replaceChildren(...items.map(([cls, label]) => h('span', { class: `chip ${cls}` }, label)));
    };
    renderChips();
    d.audio.state.on(renderChips);
    d.speech.stt.state.on(renderChips);
    d.settings.changed.on(renderChips);
}
function mirrorCard(d: PhoneDeps): HTMLElement {
    const stage = h('div', { class: 'mirror' });
    const wrap = h('div', { class: 'mirror-wrap' }, stage);
    const nodes = new Map<string, HTMLElement>();
    const urls = new Map<string, string>();
    const menuRow = h('div', { class: 'menu-items' });
    new ResizeObserver(() => {
        stage.style.transform = `scale(${wrap.clientWidth / 576})`;
    }).observe(wrap);
    d.shell.mirror.on((ev: MirrorEvent) => {
        switch (ev.kind) {
            case 'page': {
                stage.replaceChildren();
                nodes.clear();
                for (const p of ev.panels) {
                    const r = p.rect;
                    const style = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;
                    let el: HTMLElement;
                    if (p.kind === 'image') {
                        el = h('img', { style, alt: '' });
                        const url = urls.get(p.id);
                        if (url)
                            (el as HTMLImageElement).src = url;
                    }
                    else {
                        const pad = (p.padding ?? 0) + (p.border?.width ?? 0);
                        const opacity = 0.35 + (0.65 * (p.brightness ?? 4)) / 4;
                        el = h('div', { class: 'p', style: style + `padding:${pad}px;opacity:${opacity};` }, ev.texts[p.id] ?? '');
                    }
                    nodes.set(p.id, el);
                    stage.append(el);
                }
                break;
            }
            case 'text': {
                const el = nodes.get(ev.id);
                if (el)
                    el.textContent = ev.content;
                break;
            }
            case 'image': {
                const old = urls.get(ev.id);
                if (old)
                    URL.revokeObjectURL(old);
                const url = URL.createObjectURL(new Blob([ev.bytes as BlobPart], { type: 'image/png' }));
                urls.set(ev.id, url);
                const el = nodes.get(ev.id) as HTMLImageElement | undefined;
                if (el)
                    el.src = url;
                break;
            }
            case 'menu':
                menuRow.replaceChildren(...ev.items.map((label, i) => h('button', { onclick: () => (d.mock ? d.mock.menu(i + 1) : d.shell.runMenuItem(i + 1)) }, label)));
                break;
        }
    });
    const send = (kind: GestureKind) => {
        d.shell.dispatch({ kind, source: 'unknown' });
    };
    const hold = h('button', { title: 'Long-press (pause / resume translation)', onclick: () => (send('hold'), send('release')) }, 'Hold');
    return h('section', { class: 'card' }, h('h2', {}, 'Glasses'), wrap, h('div', { class: 'controls' }, h('button', { onclick: () => send('tap'), title: 'Tap (ring click)' }, 'Tap'), hold), menuRow);
}
function translateCard(d: PhoneDeps): HTMLElement {
    const t = d.translate;
    const orig = h('div', { class: 'stream orig' });
    const eng = h('div', { class: 'stream eng' });
    const replies = h('div', { class: 'replies' });
    const status = h('p', { class: 'muted status' });
    const toggle = h('button', { onclick: () => t.setLive(!t.live) });
    const suggest = h('button', { class: 'primary', onclick: () => t.suggestReplies() }, 'Suggest replies');
    const render = () => {
        orig.textContent = t.transcript.original;
        eng.textContent = t.transcript.english;
        orig.scrollTop = orig.scrollHeight;
        eng.scrollTop = eng.scrollHeight;
        toggle.textContent = t.live ? 'Pause' : 'Resume';
        suggest.toggleAttribute('disabled', t.mode === 'loading');
        status.textContent = t.notice || (t.mode === 'loading' ? '…' : t.sttState === 'error' ? `! ${t.sttDetail}` : '');
        replies.replaceChildren(...(t.mode === 'replies'
            ? t.replies.map(r => h('div', { class: 'reply' }, r.text, h('small', {}, r.english)))
            : []));
    };
    t.changed.on(render);
    render();
    return h('section', { class: 'card' }, h('h2', {}, 'Conversation'), orig, eng, h('div', { class: 'row' }, suggest, toggle, h('button', { onclick: () => t.clear() }, 'Clear')), status, replies);
}
function selectFor<K extends keyof Settings>(d: PhoneDeps, key: K, options: [
    string,
    string
][]): HTMLSelectElement {
    const sel = h('select', {}, ...options.map(([v, label]) => h('option', { value: v }, label))) as HTMLSelectElement;
    sel.value = String(d.settings.get()[key]);
    sel.addEventListener('change', () => d.settings.update({ [key]: sel.value } as Partial<Settings>));
    d.settings.changed.on(s => {
        sel.value = String(s[key]);
    });
    return sel;
}
function secretFor(d: PhoneDeps, key: 'sonioxKey' | 'sonioxOrgKey' | 'anthropicKey', placeholder: string): HTMLInputElement {
    const input = h('input', { type: 'password', placeholder, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    input.value = d.settings.get()[key];
    let timer: number | null = null;
    const save = () => {
        if (timer !== null)
            window.clearTimeout(timer);
        timer = null;
        if (input.value.trim() !== d.settings.get()[key])
            d.settings.update({ [key]: input.value.trim() });
    };
    input.addEventListener('input', () => {
        if (timer !== null)
            window.clearTimeout(timer);
        timer = window.setTimeout(save, 500);
    });
    input.addEventListener('change', save);
    input.addEventListener('blur', save);
    return input;
}
function checkRow(run: () => Promise<KeyCheck>): HTMLElement {
    const out = h('span', { class: 'check-result' });
    const btn = h('button', { type: 'button' }, 'Check') as HTMLButtonElement;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        out.className = 'check-result';
        out.textContent = 'Checking…';
        const r = await run().catch((): KeyCheck => ({ ok: false, text: 'The check could not run.' }));
        out.className = `check-result ${r.ok ? 'ok' : 'err'}`;
        out.textContent = r.text;
        btn.disabled = false;
    });
    return h('div', { class: 'row keycheck' }, btn, out);
}
function settingsCard(d: PhoneDeps): HTMLElement {
    const own = h('input', { type: 'checkbox' }) as HTMLInputElement;
    own.checked = d.settings.get().ignoreOwnVoice;
    own.addEventListener('change', () => d.settings.update({ ignoreOwnVoice: own.checked }));
    const gate = h('input', { type: 'checkbox' }) as HTMLInputElement;
    gate.checked = d.settings.get().speechGate;
    gate.addEventListener('change', () => d.settings.update({ speechGate: gate.checked }));
    const usage = h('p', { class: 'hint' });
    const renderUsage = () => {
        const { streamedMs, heardMs } = d.speech;
        usage.textContent = heardMs > 0 ? `Speech gate: streamed ${clock(streamedMs)} of ${clock(heardMs)} heard.` : '';
    };
    renderUsage();
    window.setInterval(renderUsage, 5000);
    const credit = h('p', { class: 'hint' });
    const renderCredit = () => {
        const b = d.balance;
        const usd = (n: number) => `${n.toFixed(2)}`;
        const sx = !d.settings.get().sonioxOrgKey
            ? 'Soniox: add an organization key above to show the prepaid balance.'
            : b.soniox?.invoiced
                ? 'Soniox: billed by invoice, no prepaid balance.'
                : b.soniox
                    ? `Soniox: ${usd(b.soniox.leftUsd)} left of ${usd(b.soniox.totalUsd)} prepaid (${b.sonioxPercent ?? 0}%).`
                    : 'Soniox: reading the balance…';
        const sxErr = b.sonioxError ? ` Couldn't read it just now (${b.sonioxError === '401' || b.sonioxError === '403' ? 'the organization key was refused' : b.sonioxError}).` : '';
        const cl = b.claudeEmpty
            ? ' Claude: out of prepaid credit, top up in the Claude Console.'
            : " Claude: Anthropic doesn't let apps read the prepaid balance; the glasses show CL !0% when it runs out.";
        credit.textContent = sx + sxErr + cl;
    };
    renderCredit();
    d.balance.changed.on(renderCredit);
    d.settings.changed.on(renderCredit);
    const s = d.settings.get();
    return h('section', { class: 'card' }, h('details', { open: !s.sonioxKey || !s.sonioxOrgKey || !s.anthropicKey }, h('summary', {}, 'Settings & API keys'), h('label', {}, 'Soniox API key (speech + translation)'), secretFor(d, 'sonioxKey', 'From console.soniox.com'), checkRow(() => checkSoniox(d.settings.get().sonioxKey)), h('label', {}, 'Soniox organization key (only to show the prepaid balance)'), secretFor(d, 'sonioxOrgKey', 'snx_org_… from Settings › Organization API keys'), checkRow(() => checkSonioxOrg(d.settings.get().sonioxOrgKey)), h('label', {}, 'Anthropic API key (reply suggestions)'), secretFor(d, 'anthropicKey', 'sk-ant-…'), checkRow(() => checkAnthropic(d.settings.get().anthropicKey, d.settings.get().claudeModel)), h('label', {}, 'Claude model'), selectFor(d, 'claudeModel', [
        ['claude-opus-5-5', 'Claude Opus 5.5 (best)'],
        ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster)'],
        ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest)'],
    ]), h('label', {}, 'Default language they speak (detection still runs)'), selectFor(d, 'sourceLang', [
        ['es', 'Spanish'],
        ['fr', 'French'],
        ['it', 'Italian'],
        ['pt', 'Portuguese'],
        ['de', 'German'],
        ['ca', 'Catalan'],
        ['nl', 'Dutch'],
        ['ja', 'Japanese'],
        ['zh', 'Chinese'],
        ['ko', 'Korean'],
    ]), h('label', {}, 'Microphone'), selectFor(d, 'micSource', [
        ['glasses', 'Glasses (4-mic array)'],
        ['phone', 'Phone'],
    ]), h('label', { class: 'check' }, own, "Don't translate my own voice"), h('label', { class: 'check' }, gate, 'Only stream to Soniox while someone is talking'), credit, usage, h('p', { class: 'hint' }, 'Keys are stored in the Even app on this phone and sent only to Soniox and Anthropic.')));
}
function clock(ms: number): string {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
