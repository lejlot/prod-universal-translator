export function withoutKey(text: string, key: string): string {
    return key ? text.split(key).join('…') : text;
}
