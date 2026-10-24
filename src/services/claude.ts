import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { isOutOfCredit } from '../core/balance';
import { Emitter } from '../core/emitter';
import { langLabel } from '../core/lang';
const ReplySchema = z.object({
    replies: z
        .array(z.object({
        text: z.string().describe('The reply, written in the partner language (never English unless the partner language is English). Max ~35 characters.'),
        english: z.string().describe('Short English gloss of the reply. Max ~35 characters.'),
    }))
        .describe('Exactly three distinct replies.'),
});
export type Reply = z.infer<typeof ReplySchema>['replies'][number];
export class ClaudeService {
    readonly credit = new Emitter<boolean>();
    private client: Anthropic | null = null;
    private key = '';
    constructor(private getKey: () => string, private getModel: () => string) { }
    get configured() {
        return !!this.getKey();
    }
    private api(): Anthropic {
        const key = this.getKey();
        if (!key)
            throw new Error('Add an Anthropic API key in settings');
        if (!this.client || key !== this.key) {
            this.key = key;
            this.client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 20000 });
        }
        return this.client;
    }
    private async run<T>(call: () => Promise<T>): Promise<T> {
        try {
            const out = await call();
            this.credit.emit(true);
            return out;
        }
        catch (err) {
            if (isOutOfCredit(err))
                this.credit.emit(false);
            throw err;
        }
    }
    private fallback(model: string) {
        return model.includes('haiku')
            ? {}
            : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
    }
    async suggestReplies(input: {
        original: string;
        english: string;
        lang: string;
    }): Promise<Reply[]> {
        const replies = await this.askReplies(input, false);
        if (input.lang === 'en' || !replies.some(r => looksEnglish(r.text)))
            return replies;
        const again = await this.askReplies(input, true);
        return again.some(r => looksEnglish(r.text)) ? replies : again;
    }
    private async askReplies(input: {
        original: string;
        english: string;
        lang: string;
    }, insist: boolean): Promise<Reply[]> {
        const model = this.getModel();
        const langName = langLabel(input.lang);
        const response = await this.run(() => this.api().beta.messages.parse({
            model,
            max_tokens: 2000,
            ...this.fallback(model),
            output_config: { effort: 'low', format: betaZodOutputFormat(ReplySchema) },
            system: 'You help a traveler who is wearing smart glasses hold a conversation in a language they speak poorly. ' +
                'Given what the other person just said, propose three natural, short replies the traveler could say out loud. ' +
                'Make them meaningfully different (e.g. agree / ask a clarifying question / politely decline), ' +
                'use plain everyday wording that is easy to pronounce, and keep each under about 35 characters. ' +
                'The reply text is always in the partner language — the traveler reads it out to them — never in English ' +
                '(unless the partner language is English); only the gloss is English.',
            messages: [
                {
                    role: 'user',
                    content: `Partner language: ${langName} (${input.lang}).\n\n` +
                        `What they said recently (original, newest last):\n${input.original || '(nothing yet)'}\n\n` +
                        `English translation:\n${input.english || '(nothing yet)'}\n\n` +
                        `Write the three replies in ${langName}, each with a short English gloss.` +
                        (insist ? `\n\nImportant: your previous replies were in English. The "text" of every reply must be in ${langName}.` : ''),
                },
            ],
        }));
        if (response.stop_reason === 'refusal')
            throw new Error('Claude declined to suggest replies');
        const replies = response.parsed_output?.replies ?? [];
        if (!replies.length)
            throw new Error('No replies came back');
        return replies.slice(0, 3);
    }
}
const ENGLISH_WORDS = new Set('the you your is are am i it to of and for that this what how can could would will do does please thank thanks yes sure okay ok we me my with have just looking like much'.split(' '));
export function looksEnglish(text: string): boolean {
    if (/[^\x00-\x7f]/.test(text))
        return false;
    const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
    if (words.length < 2)
        return false;
    const hits = words.filter(w => ENGLISH_WORDS.has(w)).length;
    return hits / words.length >= 0.4;
}
