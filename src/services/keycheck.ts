import { SONIOX_BALANCE_URL } from '../core/balance';
import { withoutKey } from '../core/redact';
import { MODEL as SONIOX_MODEL } from './soniox';
export interface KeyCheck {
    ok: boolean;
    text: string;
}
type Http = typeof fetch;
const TIMEOUT_MS = 10000;
const MAX_DETAIL = 160;
interface Reply {
    status: number;
    body: unknown;
}
async function ask(http: Http, url: string, init: RequestInit): Promise<Reply | null> {
    try {
        const res = await http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        return { status: res.status, body: await res.json().catch(() => null) };
    }
    catch {
        return null;
    }
}
function detail(body: unknown): string {
    const b = body as {
        message?: unknown;
        error?: {
            message?: unknown;
        } | string;
    } | null;
    const msg = typeof b?.error === 'object' ? b.error?.message : (b?.message ?? b?.error);
    return typeof msg === 'string' ? msg.trim().slice(0, MAX_DETAIL) : '';
}
function result(ok: boolean, text: string, key: string): KeyCheck {
    return { ok, text: withoutKey(text, key) };
}
function failure(service: string, r: Reply, key: string): KeyCheck {
    const said = detail(r.body);
    if (r.status === 401)
        return result(false, `${service} refused the key: it's wrong or was deleted.${said ? ` (${said})` : ''}`, key);
    if (r.status === 429)
        return result(false, `${service} says too many requests. Try again in a minute.`, key);
    return result(false, `${service} answered ${r.status}${said ? `: ${said}` : '.'}`, key);
}
function unreachable(service: string): KeyCheck {
    return { ok: false, text: `Couldn't reach ${service}. Is the phone online?` };
}
const NO_KEY: KeyCheck = { ok: false, text: 'No key entered.' };
export async function checkSoniox(key: string, http: Http = fetch): Promise<KeyCheck> {
    if (!key)
        return NO_KEY;
    const r = await ask(http, 'https://api.soniox.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
    if (!r)
        return unreachable('Soniox');
    if (r.status !== 200)
        return failure('Soniox', r, key);
    const models = (r.body as {
        models?: {
            id?: unknown;
        }[];
    } | null)?.models;
    if (Array.isArray(models) && !models.some(m => m?.id === SONIOX_MODEL)) {
        return result(false, `Soniox accepted the key, but doesn't list the model the HUD uses (${SONIOX_MODEL}).`, key);
    }
    return result(true, `Works. Soniox accepted the key${Array.isArray(models) ? ` and offers the model the HUD uses (${SONIOX_MODEL})` : ''}.`, key);
}
export async function checkSonioxOrg(key: string, http: Http = fetch): Promise<KeyCheck> {
    if (!key)
        return NO_KEY;
    const r = await ask(http, SONIOX_BALANCE_URL, { headers: { Authorization: `Bearer ${key}` } });
    if (!r)
        return unreachable('Soniox');
    if (r.status !== 200)
        return failure('Soniox', r, key);
    const b = r.body as {
        available_balance_usd?: string;
        invoice_billing_enabled?: boolean;
    } | null;
    if (b?.invoice_billing_enabled)
        return result(true, 'Works. The organization is billed by invoice, so there is no prepaid balance to show.', key);
    const left = Number(b?.available_balance_usd);
    return result(true, Number.isFinite(left) ? `Works. Soniox reports $${left.toFixed(2)} of prepaid credit left.` : 'Works. Soniox accepted the key.', key);
}
export async function checkAnthropic(key: string, model: string, http: Http = fetch): Promise<KeyCheck> {
    if (!key)
        return NO_KEY;
    const r = await ask(http, `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    if (!r)
        return unreachable('Anthropic');
    if (r.status === 404)
        return result(false, `Anthropic accepted the key, but ${model} isn't available to it. Pick another model below.`, key);
    if (r.status !== 200)
        return failure('Anthropic', r, key);
    const name = (r.body as {
        display_name?: unknown;
    } | null)?.display_name;
    return result(true, `Works. ${typeof name === 'string' ? name : model} is available to this key. (Anthropic doesn't let apps read the prepaid credit.)`, key);
}
