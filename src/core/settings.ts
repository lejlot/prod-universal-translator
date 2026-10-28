import { Emitter } from './emitter';
import type { Store } from './store';
export type MicSource = 'glasses' | 'phone';
export interface Settings {
    sonioxKey: string;
    sonioxOrgKey: string;
    anthropicKey: string;
    claudeModel: string;
    sourceLang: string;
    mainLang: string;
    shareLocation: boolean;
    micSource: MicSource;
    ignoreOwnVoice: boolean;
    swipeViews: boolean;
    speechGate: boolean;
    schema: number;
}
export const DEFAULT_SETTINGS: Settings = {
    sonioxKey: '',
    sonioxOrgKey: '',
    anthropicKey: '',
    claudeModel: 'claude-opus-5-5',
    sourceLang: 'es',
    mainLang: 'en',
    shareLocation: true,
    micSource: 'glasses',
    ignoreOwnVoice: false,
    swipeViews: true,
    speechGate: true,
    schema: 13,
};
export class SettingsStore {
    readonly changed = new Emitter<Settings>();
    private value: Settings = { ...DEFAULT_SETTINGS };
    constructor(private store: Store) { }
    async load() {
        const saved = await this.store.load('settings', { ...DEFAULT_SETTINGS, schema: 1 });
        const loadedSchema = saved.schema;
        if (saved.schema < 2) {
            saved.ignoreOwnVoice = false;
            saved.schema = 2;
        }
        if (saved.schema < 3) {
            saved.swipeViews = true;
            saved.schema = 3;
        }
        if (saved.schema < 4) {
            saved.speechGate = true;
            saved.schema = 4;
        }
        if (saved.schema < 6) {
            const old = saved as Settings & {
                claudeBudgetTokens?: number;
                sonioxBudgetHours?: number;
            };
            delete old.claudeBudgetTokens;
            delete old.sonioxBudgetHours;
            saved.sonioxOrgKey ??= '';
            saved.schema = 6;
        }
        if (saved.schema < 8)
            saved.schema = 8;
        if (saved.schema < 9) {
            delete (saved as Settings & {
                textSize?: string;
            }).textSize;
            saved.schema = 9;
        }
        if (saved.schema < 10) {
            const old = saved as Settings & {
                googleMapsKey?: string;
                travelMode?: string;
            };
            delete old.googleMapsKey;
            delete old.travelMode;
            saved.schema = 10;
        }
        if (saved.schema < 12) {
            delete (saved as Settings & {
                bridgeCode?: string;
            }).bridgeCode;
            saved.schema = 12;
        }
        if (saved.schema < 13) {
            saved.mainLang = 'en';
            saved.shareLocation = true;
            saved.schema = 13;
        }
        if (saved.schema !== loadedSchema)
            this.store.save('settings', saved, 0);
        this.value = saved;
        this.changed.emit(this.value);
    }
    get(): Settings {
        return this.value;
    }
    update(patch: Partial<Settings>) {
        this.value = { ...this.value, ...patch };
        this.store.save('settings', this.value, 300);
        this.changed.emit(this.value);
    }
}
