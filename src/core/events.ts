import { EventSourceType, OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import type { Gesture, InputSource } from './types';
export type Lifecycle = 'foreground-enter' | 'foreground-exit' | 'abnormal-exit' | 'system-exit';
export type HubSignal = {
    type: 'gesture';
    gesture: Gesture;
    fromList: boolean;
} | {
    type: 'lifecycle';
    lifecycle: Lifecycle;
} | {
    type: 'menu';
    itemId: number;
};
function isUnnamedInput(event: EvenHubEvent): boolean {
    const raw = event.jsonData;
    if (!raw || 'imuData' in raw)
        return false;
    if (raw.eventType !== undefined && raw.eventType !== null)
        return OsEventTypeList.fromJson(raw.eventType) === undefined;
    const parsed = event.sysEvent || event.textEvent || event.listEvent || event.menuItemClickEvent;
    return !parsed && raw.eventSource !== undefined;
}
function sourceOf(raw?: EventSourceType): InputSource {
    switch (raw) {
        case EventSourceType.TOUCH_EVENT_FROM_RING:
            return 'ring';
        case EventSourceType.TOUCH_EVENT_FROM_GLASSES_L:
            return 'left';
        case EventSourceType.TOUCH_EVENT_FROM_GLASSES_R:
            return 'right';
        default:
            return 'unknown';
    }
}
export function parseHubEvent(event: EvenHubEvent): HubSignal | null {
    const itemId = event.menuItemClickEvent?.itemID;
    if (itemId !== undefined && itemId !== 0)
        return { type: 'menu', itemId };
    if (!event.audioEvent && isUnnamedInput(event)) {
        const source = sourceOf(event.sysEvent?.eventSource ?? EventSourceType.fromJson(event.jsonData?.eventSource));
        return source === 'ring' ? { type: 'gesture', fromList: !!event.listEvent, gesture: { kind: 'pinch', source } } : null;
    }
    if (event.listEvent) {
        const t = event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
        if (t === OsEventTypeList.CLICK_EVENT) {
            return {
                type: 'gesture',
                fromList: true,
                gesture: { kind: 'tap', source: 'unknown' },
            };
        }
        if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
            return { type: 'gesture', fromList: true, gesture: { kind: 'double', source: 'unknown' } };
        }
        if (t === OsEventTypeList.LONG_PRESS_EVENT || t === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
            return { type: 'gesture', fromList: true, gesture: { kind: t === OsEventTypeList.LONG_PRESS_EVENT ? 'hold' : 'release', source: 'unknown' } };
        }
        return null;
    }
    if (event.textEvent) {
        const t = event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
        const kind = t === OsEventTypeList.SCROLL_TOP_EVENT
            ? 'up'
            : t === OsEventTypeList.SCROLL_BOTTOM_EVENT
                ? 'down'
                : t === OsEventTypeList.DOUBLE_CLICK_EVENT
                    ? 'double'
                    : t === OsEventTypeList.CLICK_EVENT
                        ? 'tap'
                        : t === OsEventTypeList.LONG_PRESS_EVENT
                            ? 'hold'
                            : t === OsEventTypeList.LONG_PRESS_RELEASE_EVENT
                                ? 'release'
                                : null;
        return kind ? { type: 'gesture', fromList: false, gesture: { kind, source: 'unknown' } } : null;
    }
    if (event.sysEvent) {
        const t = event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
        const source = sourceOf(event.sysEvent.eventSource);
        switch (t) {
            case OsEventTypeList.CLICK_EVENT:
                return { type: 'gesture', fromList: false, gesture: { kind: 'tap', source } };
            case OsEventTypeList.DOUBLE_CLICK_EVENT:
                return { type: 'gesture', fromList: false, gesture: { kind: 'double', source } };
            case OsEventTypeList.LONG_PRESS_EVENT:
                return { type: 'gesture', fromList: false, gesture: { kind: 'hold', source } };
            case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
                return { type: 'gesture', fromList: false, gesture: { kind: 'release', source } };
            case OsEventTypeList.SCROLL_TOP_EVENT:
                return { type: 'gesture', fromList: false, gesture: { kind: 'up', source } };
            case OsEventTypeList.SCROLL_BOTTOM_EVENT:
                return { type: 'gesture', fromList: false, gesture: { kind: 'down', source } };
            case OsEventTypeList.FOREGROUND_ENTER_EVENT:
                return { type: 'lifecycle', lifecycle: 'foreground-enter' };
            case OsEventTypeList.FOREGROUND_EXIT_EVENT:
                return { type: 'lifecycle', lifecycle: 'foreground-exit' };
            case OsEventTypeList.ABNORMAL_EXIT_EVENT:
                return { type: 'lifecycle', lifecycle: 'abnormal-exit' };
            case OsEventTypeList.SYSTEM_EXIT_EVENT:
                return { type: 'lifecycle', lifecycle: 'system-exit' };
            default:
                return null;
        }
    }
    return null;
}
