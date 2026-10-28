import { AudioHub } from './core/audio';
import { connectHost } from './core/host';
import { BleQueue } from './core/queue';
import { SettingsStore } from './core/settings';
import { Shell } from './core/shell';
import { Speech } from './core/speech';
import { Store } from './core/store';
import { Balance } from './core/balance';
import { conversationContext } from './core/context';
import type { HudModule } from './core/types';
import type { BrowserHost } from './browser/host';
import { TranslateModule } from './modules/translate';
import { mountPhoneUi, mountShell } from './phone/ui';
import { ClaudeService } from './services/claude';
import { composeBody, DASHBOARD, layerText, type Row } from './views';
const main = mountShell();
const { host, native } = await connectHost();
const queue = new BleQueue();
const store = new Store(host, queue);
const settings = new SettingsStore(store);
await settings.load();
const shell = new Shell(host, queue);
const audio = new AudioHub(host, queue);
const speech = new Speech(audio, settings);
const claude = new ClaudeService(() => settings.get().anthropicKey, () => settings.get().claudeModel);
const translate = new TranslateModule(shell, speech, claude, settings, store, () => conversationContext(host, settings.get().shareLocation));
const balance = new Balance(settings);
claude.credit.on(ok => balance.setClaudeCredit(ok));
speech.stt.state.on(({ state }) => {
    if (state === 'error' || state === 'idle')
        void balance.refresh();
});
balance.changed.on(() => shell.invalidate('shell.header'));
const modules: HudModule[] = [translate, balance];
for (const m of modules)
    shell.addModule(m);
const body = (): Row[] => composeBody({
    top: (width, rows) => translate.topRows(width, rows),
    english: (width, rows) => translate.englishRows(width, rows),
});
shell.provide('view.dim', { text: () => layerText(body(), 'dim') });
shell.provide('view.bright', { text: () => layerText(body(), 'bright') });
const redrawBody = () => {
    shell.invalidate('view.dim');
    shell.invalidate('view.bright');
};
translate.changed.on(redrawBody);
host.onEvenHubEvent(event => {
    if (event.audioEvent)
        audio.push(event.audioEvent);
    shell.handleEvent(event);
});
host.onDeviceStatusChanged(status => shell.setDeviceStatus(status.batteryLevel, status.isConnected()));
const withBattery = navigator as Navigator & {
    getBattery?: () => Promise<{
        level: number;
        addEventListener(t: string, f: () => void): void;
    }>;
};
withBattery
    .getBattery?.()
    .then(b => {
    const report = () => shell.setPhoneBattery(b.level * 100);
    report();
    b.addEventListener('levelchange', report);
})
    .catch(() => { });
host
    .getDeviceInfo()
    .then(info => info && shell.setDeviceStatus(info.status.batteryLevel, info.status.isConnected()))
    .catch(() => { });
mountPhoneUi(main, {
    shell,
    translate,
    settings,
    speech,
    audio,
    balance,
    mock: native ? null : (host as BrowserHost),
});
shell.mount(DASHBOARD);
await Promise.race([shell.ready, new Promise(r => setTimeout(r, 8000))]);
for (const m of modules) {
    try {
        await m.start?.();
    }
    catch (err) {
        void 0;
    }
}
let stopped = false;
function shutdown() {
    if (stopped)
        return;
    stopped = true;
    for (const m of modules)
        m.stop?.();
    store.flush();
}
shell.lifecycle.on(event => {
    if (event === 'system-exit' || event === 'abnormal-exit')
        shutdown();
    if (event === 'foreground-exit')
        store.flush();
});
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
        for (const m of modules)
            m.resume?.();
    else
        store.flush();
});
window.addEventListener('beforeunload', shutdown);
void 0;
