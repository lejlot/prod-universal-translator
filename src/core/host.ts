import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
export type Host = Pick<EvenAppBridge, 'createStartUpPageContainer' | 'rebuildPageContainer' | 'textContainerUpgrade' | 'updateImageRawData' | 'shutDownPageContainer' | 'audioControl' | 'onEvenHubEvent' | 'setLocalStorage' | 'getLocalStorage' | 'getAppLocation' | 'startAppLocationUpdates' | 'stopAppLocationUpdates' | 'onAppLocationChanged' | 'onDeviceStatusChanged' | 'getDeviceInfo'>;
export interface HostHandle {
    host: Host;
    native: boolean;
}
function hasNativeHandler(): boolean {
    const w = window as unknown as {
        flutter_inappwebview?: {
            callHandler?: unknown;
        };
    };
    return typeof w.flutter_inappwebview?.callHandler === 'function';
}
export async function connectHost(): Promise<HostHandle> {
    const forceMock = new URLSearchParams(location.search).has('mock');
    if (!forceMock) {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            if (hasNativeHandler())
                return { host: await waitForEvenAppBridge(), native: true };
            await new Promise(r => setTimeout(r, 50));
        }
    }
    const { BrowserHost } = await import('../browser/host');
    return { host: new BrowserHost(), native: false };
}
