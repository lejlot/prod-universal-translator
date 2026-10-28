export function langLabel(code: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
    }
    catch {
        return code;
    }
}
export const LANGUAGE_OPTIONS: [
    string,
    string
][] = [
    'en', 'es', 'ca', 'pl', 'fr', 'de', 'it', 'pt', 'nl', 'uk', 'ru', 'cs', 'sk',
    'ro', 'hu', 'el', 'sv', 'da', 'fi', 'no', 'tr', 'ar', 'he', 'hi', 'ja', 'ko', 'zh', 'vi', 'th', 'id',
].map(code => [code, langLabel(code)]);
