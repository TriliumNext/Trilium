/**
 * Builds real PDF bytes in-memory so tests can drive pdf.js' *own* parser instead of a
 * hand-rolled fake of `PDFDocumentProxy`.
 *
 * The point is contract coverage: every shape our extraction code consumes — the `Map`
 * returned by `getAttachments()`, the `[pageRef, {name}, x, y, z]` destination arrays, the
 * `contentsObj`/`titleObj` wrappers on annotations, the `OptionalContentConfig` groups — is
 * produced by pdf.js here, not asserted from memory. If upstream changes any of them the
 * tests fail, which a fake `pdfDocument` could never do (see the pdf.js 6.1 change that
 * turned `getAttachments()` into a `Map` and had to be caught by hand).
 *
 * Fixtures are assembled as raw PDF syntax rather than via a generator library so there is
 * no third dependency between us and the bytes pdf.js sees.
 */

/** A cross-reference-table PDF built from pre-serialised indirect objects. */
export function buildPdf(objects: string[]): Uint8Array {
    let out = "%PDF-1.7\n";
    const offsets: number[] = [];

    objects.forEach((body, index) => {
        offsets.push(out.length);
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    out += `startxref\n${xrefOffset}\n%%EOF\n`;

    // latin1 keeps every byte of the hand-written syntax at its literal value.
    return new Uint8Array(Buffer.from(out, "latin1"));
}

export const ATTACHMENT_TEXT = "hello attachment payload";

/**
 * The all-features fixture: two pages, a two-level outline, a highlight plus a text, an ink, a
 * free-text and a link annotation, an embedded attachment, and two optional-content groups (one
 * hidden).
 *
 * Kept as a single document so one `getDocument()` call serves every contract test; the
 * per-feature expectations live in the specs.
 */
export function allFeaturesPdf(): Uint8Array {
    return buildPdf([
        // 1 — catalog, wiring in the outline, attachment name tree and layer config.
        "<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R "
            + "/Names << /EmbeddedFiles 9 0 R >> "
            + "/OCProperties << /OCGs [12 0 R 13 0 R] "
            + "/D << /Order [12 0 R 13 0 R] /ON [12 0 R] /OFF [13 0 R] >> >> >>",
        // 2 — page tree.
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        // 3 — page 1, carrying both annotations.
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [5 0 R 14 0 R] >>",
        // 4 — page 2, target of the second outline entry, carrying a link (the one type the
        //     sidebar filters out) alongside the annotations it lists without a comment.
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [16 0 R 17 0 R 18 0 R 19 0 R 20 0 R] >>",
        // 5 — highlight annotation with a comment, author and colour.
        "<< /Type /Annot /Subtype /Highlight /Rect [100 700 200 720] "
            + "/Contents (A remark) /T (Alice) /C [1 0 0] "
            + "/QuadPoints [100 720 200 720 100 700 200 700] >>",
        // 6 — outline root.
        "<< /Type /Outlines /First 7 0 R /Last 8 0 R /Count 3 >>",
        // 7 — top-level entry with a nested child, so `items` recursion is exercised.
        "<< /Title (Chapter 1) /Parent 6 0 R /Dest [3 0 R /XYZ 0 750 0] "
            + "/First 10 0 R /Last 10 0 R /Count 1 /Next 8 0 R >>",
        // 8 — second top-level entry, on page 2 (drives the page-index sort).
        "<< /Title (Chapter 2) /Parent 6 0 R /Dest [4 0 R /XYZ 0 700 0] /Prev 7 0 R >>",
        // 9 — embedded-file name tree.
        "<< /Names [(notes.txt) 11 0 R] >>",
        // 10 — nested outline child, deliberately higher on the page than its parent.
        "<< /Title (Section 1.1) /Parent 7 0 R /Dest [3 0 R /XYZ 0 600 0] >>",
        // 11 — file specification pointing at the embedded stream.
        "<< /Type /Filespec /F (notes.txt) /UF (notes.txt) /EF << /F 15 0 R >> >>",
        // 12 — visible layer. /Usage is required for us to treat a group as a real layer.
        "<< /Type /OCG /Name (Visible layer) /Usage << /View << /ViewState /ON >> >> >>",
        // 13 — hidden layer, listed under /OFF above.
        "<< /Type /OCG /Name (Hidden layer) /Usage << /View << /ViewState /OFF >> >> >>",
        // 14 — text (sticky note) annotation, the other type we surface.
        "<< /Type /Annot /Subtype /Text /Rect [300 600 320 620] "
            + "/Contents (A sticky note) /T (Bob) /C [0 0 1] >>",
        // 15 — the attachment payload itself.
        `<< /Type /EmbeddedFile /Length ${ATTACHMENT_TEXT.length} >>\n`
            + `stream\n${ATTACHMENT_TEXT}\nendstream`,
        // 16 — a link annotation: a type the sidebar does not display.
        "<< /Type /Annot /Subtype /Link /Rect [50 50 150 70] /A << /S /URI /URI (https://example.com) >> >>",
        // 17 — a highlight with neither a comment nor highlighted text: what a highlight on a
        //      page with no extractable glyphs (a scan) looks like.
        "<< /Type /Annot /Subtype /Highlight /Rect [200 200 300 220] "
            + "/QuadPoints [200 220 300 220 200 200 300 200] >>",
        // 18 — an ink annotation, which is what pdf.js writes for a free-hand highlight.
        "<< /Type /Annot /Subtype /Ink /Rect [400 400 500 450] /C [0 0 0] "
            + "/InkList [[400 400 450 450 500 400]] >>",
        // 19 — a free-text box, what the toolbar's text tool writes. Its own words are its
        //      contents, so unlike ink it reaches the sidebar with something to show.
        "<< /Type /Annot /Subtype /FreeText /Rect [100 300 300 340] "
            + "/Contents (Typed in the box) /DA (/Helv 12 Tf 0 g) >>",
        // 20 — the other ink: a highlight drawn free-hand, which pdf.js marks with /IT so it
        //      can be told apart from object 18's pen stroke.
        "<< /Type /Annot /Subtype /Ink /IT /InkHighlight /Rect [400 100 500 150] /C [1 1 0] "
            + "/InkList [[400 100 450 150 500 100]] >>"
    ]);
}

/**
 * A document whose optional-content groups cover every awkward case `layers.ts` has to cope
 * with: a normal visible layer, a hidden one, one with no `/Name`, one nested under a group
 * label, and one left out of `/Order` entirely.
 *
 * The last two both reach us as `{ name, order }` entries — a nested group keeps its label,
 * while groups missing from `/Order` are gathered into a synthetic entry with a null name (see
 * `parseOrder`/`parseNestedOrder` in pdf.js' catalog). Note the nesting syntax: the label
 * belongs *inside* the sub-array, as `[(Grouped) 7 0 R]`.
 */
export function layeredPdf(): Uint8Array {
    return buildPdf([
        "<< /Type /Catalog /Pages 2 0 R /OCProperties "
            + "<< /OCGs [4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] "
            + "/D << /Order [4 0 R 5 0 R 6 0 R [(Grouped) 7 0 R]] "
            + "/ON [4 0 R 6 0 R 7 0 R 8 0 R] /OFF [5 0 R] >> >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        "<< /Type /OCG /Name (Visible layer) >>",
        "<< /Type /OCG /Name (Hidden layer) >>",
        // No /Name: pdf.js reports `name: null`, which we must not surface as a layer.
        "<< /Type /OCG >>",
        "<< /Type /OCG /Name (Nested layer) >>",
        // Absent from /Order, so pdf.js hands it back under the synthetic null-named entry.
        "<< /Type /OCG /Name (Unordered layer) >>"
    ]);
}

/** A one-page document with no outline, attachments or layers, for the empty paths. */
export function barePdf(): Uint8Array {
    return buildPdf([
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"
    ]);
}
