import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import becca_loader from "../becca/becca_loader.js";
import BBranch from "../becca/entities/bbranch.js";
import BNote from "../becca/entities/bnote.js";
import * as cls from "../services/context.js";
import { getSql } from "../services/sql/index.js";
import migration from "./0241__drop_clipper_globe_icon.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Migration 0241: clippings drop the globe icon the clipper wrote", () => {
    beforeEach(async () => {
        // Resolved here rather than at describe-collection time, after initializeCore() has run.
        getSql().rebuildFromBuffer(readFileSync(join(__dirname, "../test/fixtures/document.db")));
        await inContext(() => becca_loader.load());
    });

    it("removes the clipper's globe from clippings and leaves every other icon", async () => {
        await inContext(() => {
            buildNote("clipped", { clipType: "page", iconClass: "bx bx-globe" });
            buildNote("customized", { clipType: "note", iconClass: "bx bx-star" });
            buildNote("notClipped", { iconClass: "bx bx-globe" });
            const parent = buildNote("inheritsGlobe", { clipType: "tabs" });
            parent.addLabel("iconClass", "bx bx-globe", true);
            buildNote("child", {}, "inheritsGlobe");
        });

        await inContext(() => migration());
        await inContext(() => becca_loader.load());

        await inContext(() => {
            const iconOf = (noteId: string) => becca.getNoteOrThrow(noteId).getOwnedLabelValue("iconClass");

            expect(iconOf("clipped")).toBeNull();
            expect(becca.getNoteOrThrow("clipped").getOwnedLabelValue("clipType")).toBe("page");
            expect(iconOf("customized")).toBe("bx bx-star");
            expect(iconOf("notClipped")).toBe("bx bx-globe");
            // An inheritable globe was written by the user, not by the clipper.
            expect(iconOf("inheritsGlobe")).toBe("bx bx-globe");
        });
    });
});

/** Runs `fn` inside a CLS context, which entity writes and becca loads both require. */
function inContext<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        cls.getContext().init(() => {
            try {
                resolve(fn());
            } catch (e) {
                reject(e);
            }
        });
    });
}

function buildNote(noteId: string, labels: Record<string, string>, parentNoteId = "root") {
    const note = new BNote({
        noteId,
        title: noteId,
        type: "text",
        mime: "text/html",
        isProtected: false,
        blobId: ""
    }).save();
    new BBranch({ noteId, parentNoteId }).save();

    for (const [ name, value ] of Object.entries(labels)) {
        note.addLabel(name, value);
    }

    return note;
}
