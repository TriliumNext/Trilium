import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import { endLivePrint, getLivePrintTarget, printLiveInBrowser, startLivePrint } from "./live_print";

/** The job of the last live print a test started, ended after each test. */
let lastJobId: number | undefined;
async function start(...args: Parameters<typeof startLivePrint>) {
    lastJobId = await startLivePrint(...args);
    return lastJobId;
}

function addThemeLink(href: string, media?: string) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    if (media) link.media = media;
    link.setAttribute("data-theme-stylesheet", "true");
    document.head.appendChild(link);
    return link;
}

describe("live print", () => {
    beforeEach(() => {
        // Let happy-dom report the stylesheets it does not fetch as loaded.
        const happyDOM = (window as any).happyDOM;
        happyDOM.settings.disableCSSFileLoading = true;
        happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
        (document as any).fonts = { ready: Promise.resolve() };
    });

    afterEach(() => {
        if (lastJobId !== undefined) endLivePrint(lastJobId);
        lastJobId = undefined;
        for (const link of document.head.querySelectorAll("link")) link.remove();
        document.body.replaceChildren();
    });

    it("marks the target, prints the light baseline and applies printCss, then restores everything", async () => {
        const plainTheme = addThemeLink("theme-dark.css");
        const autoTheme = addThemeLink("theme-next-dark.css", "(prefers-color-scheme: dark)");
        const css = buildNote({ id: "live-css", title: "CSS", type: "code" });
        const text = buildNote({ id: "live-text", title: "Not CSS", type: "text" });
        const note = buildNote({ id: "live-host", title: "Host", type: "render" });
        note.getRelationTargets = async () => [ css, text ];
        const target = document.createElement("div");
        document.body.appendChild(target);

        await start(note, target);

        expect(document.body.classList.contains("print-live")).toBe(true);
        expect(target.classList.contains("print-live-target")).toBe(true);
        expect(plainTheme.media).toBe("screen");
        expect(autoTheme.media).toBe("screen and (prefers-color-scheme: dark)");
        const printCss = [ ...document.head.querySelectorAll<HTMLLinkElement>("link[data-live-print-css]") ];
        expect(printCss.map((link) => [ link.getAttribute("href"), link.media ])).toEqual([ [ "api/notes/live-css/download", "print" ] ]);

        endLivePrint(lastJobId ?? -1);

        expect(document.body.classList.contains("print-live")).toBe(false);
        expect(target.classList.contains("print-live-target")).toBe(false);
        expect(plainTheme.media).toBe("");
        expect(autoTheme.media).toBe("(prefers-color-scheme: dark)");
        expect(plainTheme.hasAttribute("data-live-print-media")).toBe(false);
        expect(document.head.querySelector("link[data-live-print-css]")).toBeNull();
    });

    it("keeps a single target when a second live print starts before the first ended", async () => {
        const theme = addThemeLink("theme-dark.css");
        const note = buildNote({ id: "live-twice", title: "Twice", type: "render" });
        const first = document.createElement("div");
        const second = document.createElement("div");
        document.body.append(first, second);

        await start(note, first);
        await start(note, second);

        expect(first.classList.contains("print-live-target")).toBe(false);
        expect(second.classList.contains("print-live-target")).toBe(true);
        expect(theme.media).toBe("screen");
    });

    it("prints scroll containers at full height without a scrollbar", async () => {
        const note = buildNote({ id: "live-scroll", title: "Scroll", type: "render" });
        const target = document.createElement("div");
        target.innerHTML = `
            <div class="scroller" style="overflow-y: auto; max-height: 100px"><table></table></div>
            <div class="clipped" style="overflow: hidden"></div>`;
        document.body.appendChild(target);

        await start(note, target);

        expect(target.querySelector(".scroller")?.classList.contains("print-live-unscroll")).toBe(true);
        expect(target.querySelector(".clipped")?.classList.contains("print-live-unscroll")).toBe(false);

        endLivePrint(lastJobId ?? -1);

        expect(target.querySelector(".print-live-unscroll")).toBeNull();
    });

    it("ignores the end of a job that a newer live print replaced", async () => {
        const note = buildNote({ id: "live-jobs", title: "Jobs", type: "render" });
        const first = document.createElement("div");
        const second = document.createElement("div");
        document.body.append(first, second);

        const firstJob = await start(note, first);
        const secondJob = await start(note, second);
        expect(secondJob).not.toBe(firstJob);

        // A late `print-done` of the first job leaves the second one prepared.
        endLivePrint(firstJob);
        expect(document.body.classList.contains("print-live")).toBe(true);
        expect(second.classList.contains("print-live-target")).toBe(true);

        endLivePrint(secondJob);
        expect(document.body.classList.contains("print-live")).toBe(false);
        expect(second.classList.contains("print-live-target")).toBe(false);
    });

    it("prints through the browser dialog and restores the window afterwards", async () => {
        const note = buildNote({ id: "live-browser", title: "Browser", type: "render" });
        const target = document.createElement("div");
        document.body.appendChild(target);
        const print = vi.fn(() => {
            expect(target.classList.contains("print-live-target")).toBe(true);
        });
        window.print = print;

        await printLiveInBrowser(note, target);
        expect(print).toHaveBeenCalledOnce();
        expect(target.classList.contains("print-live-target")).toBe(true);

        window.dispatchEvent(new Event("afterprint"));
        expect(target.classList.contains("print-live-target")).toBe(false);
    });
});

describe("getLivePrintTarget", () => {
    it("prints the render output only while the render widget is the one shown", () => {
        const noteDetail = document.createElement("div");
        noteDetail.innerHTML = `<div class="note-detail-render"><div class="note-detail-render-content">Output</div></div>`;
        const content = noteDetail.querySelector(".note-detail-render-content");

        expect(getLivePrintTarget(noteDetail, "render")).toBe(content);
        // Another view of the note (attachments, source) keeps the render widget mounted but hidden.
        expect(getLivePrintTarget(noteDetail, "attachmentList")).toBeUndefined();
        expect(getLivePrintTarget(noteDetail, undefined)).toBeUndefined();
        expect(getLivePrintTarget(null, "render")).toBeUndefined();
    });
});
