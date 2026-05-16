import { trimIndentation } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { buildNote, buildNotes } from "../../test/becca_easy_mocking";
import note_map from "./note_map";

describe("Note map service", () => {
    it("correctly identifies backlinks", () => {
        const note = buildNote({ id: "dUtgloZIckax", title: "Backlink text" });
        buildNotes([
            {
                title: "First",
                id: "first",
                "~internalLink": "dUtgloZIckax",
                content: trimIndentation`\
                    <p>
                        The quick brownie
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <figure class="image">
                        <img style="aspect-ratio:960/1280;" src="api/attachments/llY9IHS3ZSqE/image/5877566469045340078_121.jpg" width="960" height="1280">
                    </figure>
                `
            },
            {
                title: "Second",
                id: "second",
                "~internalLink": "dUtgloZIckax",
                content: trimIndentation`\
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/wsq5D7wgKWrg">
                            First
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/TvyONGWYgV7N">
                            Second
                        </a>
                    </p>
                `
            }
        ]);

        const backlinksResponse = note_map.getBacklinks({
            params: {
                noteId: note.noteId
            }
        } as any);
        expect(backlinksResponse).toMatchObject([
            {
                excerpts: [
                    trimIndentation`\
                    <div class="ck-content backlink-excerpt"><p>
                        The quick brownie
                    </p>
                    <p>
                        <a class="reference-link backlink-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <figure class="image">
                    ${"    "}
                    </figure>
                    </div>`
                ],
                noteId: "first",
            },
            {
                excerpts: [
                    trimIndentation`\
                    <div class="ck-content backlink-excerpt"><p>
                        <a class="reference-link backlink-link" href="#root/dUtgloZIckax">
                            Backlink text
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/wsq5D7wgKWrg">
                            First
                        </a>
                    </p>
                    <p>
                        <a class="reference-link" href="#root/dUtgloZIckax/TvyONGWYgV7N">
                            Second
                        </a>
                    </p>
                    </div>`
                ],
                noteId: "second"
            }
        ]);
    });
});
