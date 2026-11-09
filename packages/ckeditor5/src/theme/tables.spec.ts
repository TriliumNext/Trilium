import "ckeditor5/ckeditor5.css";
import "./tables.css";

import { describe, expect, it, onTestFinished } from "vitest";
import { cdp } from "vitest/browser";

/** The rules that Bootstrap's reboot and its `.table` class give a table row in the app. */
const BOOTSTRAP_ROW_RULES = `
    tr { border-color: inherit; border-style: solid; border-width: 0; }
    .table > :not(caption) > * > * { border-bottom-width: 1px; }
`;

describe("tables.css", () => {
    it("fills the width of the content unless resized, on screen and in print", async () => {
        const content = render(`
            <figure class="table"><table><tbody><tr><td>a</td></tr></tbody></table></figure>
            <figure class="table" style="width:40%;">
                <table><tbody><tr><td>b</td></tr></tbody></table>
            </figure>
        `);
        const [ full, resized ] = content.querySelectorAll("figure");

        for (const media of [ "screen", "print" ]) {
            await emulateMedia(media);
            expect.soft(full.getBoundingClientRect().width, media).toBe(600);
            expect.soft(resized.getBoundingClientRect().width, media).toBe(240);
        }
    });

    it("draws no border on a row, so cells without borders show no lines", () => {
        const bootstrap = document.head.appendChild(document.createElement("style"));
        bootstrap.textContent = BOOTSTRAP_ROW_RULES;
        onTestFinished(() => bootstrap.remove());
        const content = render(`<figure class="table"><table><tbody>
            <tr><td style="border-style:none;">a</td></tr>
            <tr><td style="border-style:none;">b</td></tr>
        </tbody></table></figure>`);
        const rows = content.querySelectorAll("tr");

        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(getComputedStyle(row).borderBottomWidth).toBe("0px");
        }
    });
});

function render(html: string) {
    const content = document.body.appendChild(document.createElement("div"));
    onTestFinished(() => content.remove());
    content.className = "ck-content";
    content.style.width = "600px";
    content.innerHTML = html;
    return content;
}

async function emulateMedia(media: string) {
    const session = cdp() as { send(method: string, params: object): Promise<unknown> };
    await session.send("Emulation.setEmulatedMedia", { media });
    onTestFinished(() => session.send("Emulation.setEmulatedMedia", { media: "" }));
}
