import { marquee, MARQUEE_STEP_MS, overflows } from './textfit';
export class Roller {
    private tick = 0;
    private timer: number | null = null;
    private text = '';
    constructor(private redraw: () => void) { }
    fit(text: string, width: number): string {
        if (text !== this.text) {
            this.text = text;
            this.tick = 0;
        }
        const rolling = !!text && overflows(text, width);
        if (rolling && this.timer === null) {
            this.timer = window.setInterval(() => {
                this.tick++;
                this.redraw();
            }, MARQUEE_STEP_MS);
        }
        else if (!rolling)
            this.stop();
        return rolling ? marquee(text, width, this.tick) : text;
    }
    stop() {
        if (this.timer !== null)
            window.clearInterval(this.timer);
        this.timer = null;
        this.tick = 0;
    }
}
