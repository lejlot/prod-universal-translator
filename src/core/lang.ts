export function langLabel(code: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
    }
    catch {
        return code;
    }
}
