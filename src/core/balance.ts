import { Emitter } from './emitter';
import type { SettingsStore } from './settings';
import type { HudModule } from './types';
export const SONIOX_BALANCE_URL = 'https://api.soniox.com/v1/organization/balance';
export const POLL_MS = 60000;
export interface SonioxBalance {
    leftUsd: number;
    totalUsd: number;
    exhausted: boolean;
    invoiced: boolean;
}
interface BalanceResponse {
    available_balance_usd: string;
    used_balance_usd: string;
    invoice_billing_enabled: boolean;
    balance_exhausted: boolean;
}
export function isOutOfCredit(err: unknown): boolean {
    return /credit balance is too low|billing_error/i.test(String((err as Error)?.message ?? err));
}
export class Balance implements HudModule {
    readonly id = 'balance';
    readonly title = 'Balance';
    readonly changed = new Emitter();
    soniox: SonioxBalance | null = null;
    sonioxError = '';
    claudeEmpty = false;
    private timer: number | null = null;
    private inflight: Promise<void> | null = null;
    private key = '';
    constructor(private settings: SettingsStore, private http: typeof fetch = (...a) => fetch(...a)) { }
    start() {
        this.settings.changed.on(s => {
            if (s.sonioxOrgKey !== this.key)
                void this.refresh();
        });
        void this.refresh();
        this.timer = window.setInterval(() => void this.refresh(), POLL_MS);
    }
    resume() {
        void this.refresh();
    }
    stop() {
        if (this.timer !== null)
            window.clearInterval(this.timer);
    }
    setClaudeCredit(ok: boolean) {
        if (this.claudeEmpty === !ok)
            return;
        this.claudeEmpty = !ok;
        this.changed.emit();
    }
    refresh(): Promise<void> {
        this.inflight ??= this.read().finally(() => (this.inflight = null));
        return this.inflight;
    }
    private async read() {
        const key = (this.key = this.settings.get().sonioxOrgKey);
        if (!key) {
            this.soniox = null;
            this.sonioxError = '';
            return void this.changed.emit();
        }
        try {
            const r = await this.http(SONIOX_BALANCE_URL, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
            if (!r.ok)
                throw new Error(String(r.status));
            const b = (await r.json()) as BalanceResponse;
            const left = Number(b.available_balance_usd);
            const used = Number(b.used_balance_usd);
            this.soniox = { leftUsd: left, totalUsd: left + used, exhausted: b.balance_exhausted, invoiced: b.invoice_billing_enabled };
            this.sonioxError = '';
        }
        catch (err) {
            this.sonioxError = (err as Error).message || 'unreachable';
        }
        this.changed.emit();
    }
    get sonioxPercent(): number | null {
        const s = this.soniox;
        if (!s || s.invoiced || !(s.totalUsd > 0))
            return null;
        return Math.max(0, Math.min(100, Math.round((100 * s.leftUsd) / s.totalUsd)));
    }
    status(): string {
        const p = this.soniox?.exhausted ? 0 : this.sonioxPercent;
        const sx = p !== null ? `SX ${p < 10 ? '!' : ''}${p}%` : this.soniox?.invoiced ? '' : 'SX ?';
        return [this.claudeEmpty ? 'CL !0%' : '', sx].filter(Boolean).join('  ');
    }
}
