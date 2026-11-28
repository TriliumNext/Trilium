import { measureTextLines } from "../../../services/text_lines";
import { isHtmlEmpty } from "../../../services/utils";
import type { Bounds, InkTextBox } from "./ink_document";

/** A run of the text of a text box, as a canvas draws it: in one font, on one line. */
export interface TextRun {
    text: string;
    /** The left edge and the vertical middle of the text, in world units. */
    x: number;
    y: number;
    /** The CSS `font` of the text, its size in world units. */
    font: string;
    /** The color, or `undefined` for text in the text color of the theme. */
    color?: string;
}

/** The text of a text box where the browser laid it out, and the rectangle of the box. */
export interface MeasuredTextBox {
    bounds: Bounds;
    runs: TextRun[];
}

/** What `TextBoxMeasurer` keeps of a box: its height and its runs, from its top left corner. */
interface Measurement {
    signature: string;
    height: number;
    runs: TextRun[];
}

/**
 * Reads the text of the text boxes of a note from the elements that `TextBoxLayer` shows them
 * in, for the thumbnail of the note to draw. A box is read again only once its text, its width or
 * its font size has changed, as wrapped text is measured one character at a time.
 */
export default class TextBoxMeasurer {

    private measurements = new Map<string, Measurement>();

    /** @param getLayer returns the element whose children are the boxes, each with its `data-box-id`. */
    constructor(private getLayer: () => HTMLElement | null) {}

    /**
     * Returns the text of each of `boxes` that has some. A box whose element is missing or not
     * laid out, as in a hidden tab, is left out.
     */
    measure(boxes: InkTextBox[]): MeasuredTextBox[] {
        const elements = new Map<string, HTMLElement>();
        for (const element of this.getLayer()?.children ?? []) {
            const id = element instanceof HTMLElement ? element.dataset.boxId : undefined;
            if (id !== undefined) elements.set(id, element as HTMLElement);
        }

        const measured: MeasuredTextBox[] = [];
        for (const box of boxes) {
            if (isHtmlEmpty(box.html)) continue;
            const signature = `${box.width}|${box.fontSize}|${box.html}`;
            let measurement = this.measurements.get(box.id);
            if (measurement?.signature !== signature) {
                const element = elements.get(box.id);
                measurement = element && readTextBox(element, signature);
                if (!measurement) continue;
                this.measurements.set(box.id, measurement);
            }
            measured.push({
                bounds: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + measurement.height },
                runs: measurement.runs.map((run) => ({ ...run, x: box.x + run.x, y: box.y + run.y }))
            });
        }

        for (const id of [ ...this.measurements.keys() ]) {
            if (!boxes.some((box) => box.id === id)) this.measurements.delete(id);
        }
        return measured;
    }
}

/** Draws the text of `box` on `ctx`, which is in world units, with `autoColor` as the text color of the theme. */
export function drawTextBox(ctx: CanvasRenderingContext2D, box: MeasuredTextBox, autoColor: string) {
    ctx.textBaseline = "middle";
    for (const run of box.runs) {
        ctx.font = run.font;
        ctx.fillStyle = run.color ?? autoColor;
        ctx.fillText(run.text, run.x, run.y);
    }
}

function readTextBox(element: HTMLElement, signature: string): Measurement | undefined {
    const lines = measureTextLines(element, true);
    if (!lines) return undefined;

    const autoColor = getComputedStyle(element).color;
    const styles = new Map<Element, Pick<TextRun, "font" | "color">>();
    const runs = lines.map(({ text, x, centerY, source }) => {
        let style = styles.get(source);
        if (!style) {
            const { fontStyle, fontWeight, fontSize, fontFamily, color } = getComputedStyle(source);
            style = {
                font: `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`,
                ...(color !== autoColor && { color })
            };
            styles.set(source, style);
        }
        return { text, x, y: centerY, ...style };
    });
    return { signature, height: element.offsetHeight, runs };
}
