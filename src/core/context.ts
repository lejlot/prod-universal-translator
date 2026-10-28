import { AppLocationAccuracy } from '@evenrealities/even_hub_sdk';
import type { Host } from './host';
export async function conversationContext(host: Host, shareLocation: boolean): Promise<string> {
    const context: Record<string, unknown> = {
        time: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (!shareLocation) {
        context.location = 'Location sharing is off';
        return JSON.stringify(context);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const loc = await Promise.race([
            host.getAppLocation({ accuracy: AppLocationAccuracy.Medium, timeoutMs: 4000 }).catch(() => null),
            new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 4500); }),
        ]);
        const valid = loc && Number.isFinite(loc.latitude) && Math.abs(loc.latitude) <= 90 &&
            Number.isFinite(loc.longitude) && Math.abs(loc.longitude) <= 180 &&
            (loc.timestamp === undefined || Math.abs(Date.now() - loc.timestamp) <= 120000);
        context.location = valid ? {
            latitude: loc.latitude, longitude: loc.longitude,
            ...(Number.isFinite(loc.accuracy) ? { accuracyMeters: loc.accuracy } : {}),
            measuredAt: new Date(loc.timestamp ?? Date.now()).toISOString(),
        } : 'Location unavailable';
    }
    catch {
        context.location = 'Location unavailable';
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
    return JSON.stringify(context);
}
