import { describe, expect, it } from "vitest";

import diffAiResponse from "./ai_diff.js";

const ORIGINAL = [
    "<h2>Backups</h2>",
    "<p>Trilium keeps a copy of the database every day, every week and every month.</p>",
    "<p>You can restore one by stopping the application and swapping the file.</p>"
].join("");

describe("diffAiResponse", () => {
    it("marks a corrected word inside the paragraph it was corrected in", () => {
        const corrected = ORIGINAL.replace("swapping the file.", "swapping the file out.");
        const { html, rewriteRatio } = diffAiResponse(ORIGINAL, corrected);

        // The two untouched blocks come through as they were, and the third carries the mark.
        expect(html).toContain("<h2>Backups</h2>");
        expect(html).toContain("<ins class=\"diffins\">");
        expect(html).not.toContain("diffblock");
        expect(rewriteRatio).toBe(0);
    });

    it("shows a paragraph that shares no words as a replacement rather than word by word", () => {
        const translated = [
            "<h2>Copii de rezervă</h2>",
            "<p>Trilium păstrează o copie a bazei de date în fiecare zi, săptămână și lună.</p>",
            "<p>Poți restaura una oprind aplicația și înlocuind fișierul.</p>"
        ].join("");
        const { html, rewriteRatio } = diffAiResponse(ORIGINAL, translated);

        // Each old block struck out whole, with the block that replaced it right after — not the
        // alternating word pairs a plain word-level diff produces for two unrelated texts.
        expect(html).toBe([
            "<del class=\"diffdel diffblock\"><h2>Backups</h2></del>",
            "<ins class=\"diffins diffblock\"><h2>Copii de rezervă</h2></ins>",
            "<del class=\"diffdel diffblock\"><p>Trilium keeps a copy of the database every day, every week and every month.</p></del>",
            "<ins class=\"diffins diffblock\"><p>Trilium păstrează o copie a bazei de date în fiecare zi, săptămână și lună.</p></ins>",
            "<del class=\"diffdel diffblock\"><p>You can restore one by stopping the application and swapping the file.</p></del>",
            "<ins class=\"diffins diffblock\"><p>Poți restaura una oprind aplicația și înlocuind fișierul.</p></ins>"
        ].join(""));
        // Nothing of the response was an edit, which is what sends the review to the result view.
        expect(rewriteRatio).toBe(1);
    });

    it("keeps a restructured block whole instead of interleaving two kinds of markup", () => {
        const asList = "<ul><li>A daily copy</li><li>A weekly copy</li><li>A monthly copy</li></ul>";
        const { html } = diffAiResponse("<p>Trilium keeps a daily, weekly and monthly copy.</p>", asList);

        // A `<p>` word-diffed against a `<ul>` comes out with its tags closing in the wrong order.
        expect(html).toBe(
            "<del class=\"diffdel diffblock\"><p>Trilium keeps a daily, weekly and monthly copy.</p></del>"
            + `<ins class="diffins diffblock">${asList}</ins>`
        );
    });

    // The prefilter reads two casings of one sentence as the same sentence — it compares lowercased
    // words — while the word differ recognises not one of them, so this is the pair that gets past
    // the block pass and comes back with every word of the paragraph marked twice.
    it("shows a recased paragraph as a replacement rather than marking every word of it", () => {
        const { html, rewriteRatio } = diffAiResponse(
            "<p>Age, imaginemur numeros esse quasi scalas magicas quae deorsum descendunt!</p>",
            "<p>AGE IMAGINEMVR NVMEROS ESSE QVASI SCALAS MAGICAS QVAE DEORSVM DESCENDVNT</p>"
        );

        expect(html).toBe([
            "<del class=\"diffdel diffblock\"><p>Age, imaginemur numeros esse quasi scalas magicas quae deorsum descendunt!</p></del>",
            "<ins class=\"diffins diffblock\"><p>AGE IMAGINEMVR NVMEROS ESSE QVASI SCALAS MAGICAS QVAE DEORSVM DESCENDVNT</p></ins>"
        ].join(""));
        expect(rewriteRatio).toBe(1);
    });

    // The other side of the same measurement: a text the model recased *in places* is still the
    // text it was, and the marks land on the words that moved.
    it("keeps the word diff when only some of a block came out marked", () => {
        const { html } = diffAiResponse(
            "<p>trilium keeps a copy of the database every day.</p>",
            "<p>Trilium keeps a copy of the database every day.</p>"
        );

        expect(html).toBe(
            "<p><del class=\"diffmod\">trilium</del><ins class=\"diffmod\">Trilium</ins>"
            + " keeps a copy of the database every day.</p>"
        );
    });

    it("marks an added paragraph as an addition, leaving the ratio to the rewrites", () => {
        const expanded = ORIGINAL.replace("<p>You can", "<p>The copies live next to the database file.</p><p>You can");
        const { html, rewriteRatio } = diffAiResponse(ORIGINAL, expanded);

        expect(html).toContain("<ins class=\"diffins diffblock\"><p>The copies live next to the database file.</p></ins>");
        expect(html).not.toContain("diffdel");
        // An insertion is readable as a diff however large it is, so it is not a rewrite.
        expect(rewriteRatio).toBe(0);
    });

    it("renders an unchanged block in the shape the response gave it", () => {
        const { html } = diffAiResponse(
            "<p>Never edit the database while the app runs.</p>",
            "<blockquote class=\"admonition warning\"><p>Never edit the database while the app runs.</p></blockquote>"
        );

        expect(html).toBe("<blockquote class=\"admonition warning\"><p>Never edit the database while the app runs.</p></blockquote>");
    });

    // What a run at a collapsed caret actually looks like: the assistant widens to the block and
    // stringifies its *contents*, so the captured side has no paragraph, while the response — being
    // rendered Markdown — always has one. Compared as markup that pair is a different block
    // entirely, and a one-word fix comes out as the whole paragraph replaced.
    it("marks a fixed word when the captured side has no container and the response has one", () => {
        const { html, rewriteRatio } = diffAiResponse(
            "You can play with it, and modify the note structurey as you wish.",
            "<p>You can play with it, and modify the note structure as you wish.</p>"
        );

        expect(html).toBe(
            "<p>You can play with it, and modify the note "
            + "<del class=\"diffmod\">structurey</del><ins class=\"diffmod\">structure</ins>"
            + " as you wish.</p>"
        );
        expect(rewriteRatio).toBe(0);
    });

    // Serializing a text node by hand escapes what the browser leaves alone, and the word differ
    // then marks `&quot;` against `"` as a change the model never made.
    it("escapes a loose text node the way the browser escapes the same text in an element", () => {
        const { html } = diffAiResponse("a \"demo\" document", "<p>a \"demo\" document</p>");

        expect(html).toBe("<p>a \"demo\" document</p>");
    });

    it("diffs a selection made inside a paragraph, which has no blocks at all", () => {
        const { html } = diffAiResponse("the quick <strong>brown</strong> fox", "the quick <strong>red</strong> fox");

        expect(html).toContain("brown");
        expect(html).toContain("red");
        expect(html).not.toContain("diffblock");
    });

    it("treats a response with nothing to align against as entirely rewritten", () => {
        expect(diffAiResponse("", "<p>generated</p>").rewriteRatio).toBe(1);
    });

    // Proofreading text that has nothing wrong with it. The container the response adds is not a
    // change — otherwise an untouched response could never be reported as untouched.
    it("reports a response that changed nothing, container differences aside", () => {
        expect(diffAiResponse(ORIGINAL, ORIGINAL).isUnchanged).toBe(true);
        expect(diffAiResponse("It is already perfect.", "<p>It is already perfect.</p>").isUnchanged).toBe(true);

        for (const [name, changed] of [
            ["a word", ORIGINAL.replace("every day", "daily")],
            ["a block", `${ORIGINAL}<p>One more thought.</p>`],
            // The same words, but the note would come out different — so not "no changes".
            ["only the markup", ORIGINAL.replace("<h2>Backups</h2>", "<h3>Backups</h3>")]
        ] as const) {
            expect(diffAiResponse(ORIGINAL, changed).isUnchanged, name).toBe(false);
        }
    });
});
