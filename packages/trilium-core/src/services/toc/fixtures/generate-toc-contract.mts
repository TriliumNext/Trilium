/**
 * Writes `toc_contract.pdf`, the PDF that the readers of PDF outlines must agree on, and
 * `toc_contract.json`, its headings and ids as `unpdf` reads them. Run it after a change of the
 * outline reader or of the ids, from the repository root:
 *
 *     node_modules/.bin/tsx packages/trilium-core/src/services/toc/fixtures/generate-toc-contract.mts
 *
 * Check the JSON by hand before it is committed: the specs compare every reader with it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { readPdfOutline, toPdfTocHeadings } from "../../../../../commons/src/lib/pdf_toc.js";
import { buildContract, fixturesDir, writeContract } from "./contract.mjs";

const bytes = buildContractPdf();
writeFileSync(join(fixturesDir, "toc_contract.pdf"), bytes);

const { getDocumentProxy } = await import("unpdf");
const pdf = await getDocumentProxy(new Uint8Array(bytes));
const headings = toPdfTocHeadings((await readPdfOutline(pdf)).headings);
await pdf.loadingTask.destroy();

writeContract("toc_contract.json", buildContract(bytes, headings, false, { headings }));

/**
 * Three pages, and an outline with every shape of destination, titles in UTF-16 and in
 * PDFDocEncoding, a title that the cut at 500 code units ends in a space, two sibling headings of
 * one title, and a group at level 32 without a destination over a child at level 33.
 */
function buildContractPdf() {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body);
    const ref = (index: number) => `${index} 0 R`;

    add("<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R /Names << /Dests 7 0 R >> >>");
    add("<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>");
    for (let page = 0; page < 3; page++) {
        add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>");
    }
    // 6, the outline root, is written once the entries are numbered.
    add("");
    add("<< /Names [(chapter-2) [4 0 R /XYZ 0 792 0]] >>");

    interface Entry { title: string; target: string; children?: Entry[] }
    const utf16 = (text: string) => `<FEFF${[ ...text ].map((char) =>
        char.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase()}>`;
    let chain: Entry = { title: "(Deep child)", target: "/Dest [5 0 R /Fit]" };
    chain = { title: "(Group without a destination)", target: "", children: [ chain ] };
    for (let level = 31; level >= 1; level--) {
        chain = { title: `(Level ${level})`, target: "/Dest [3 0 R /Fit]", children: [ chain ] };
    }
    const entries: Entry[] = [
        { title: "(Chapter 1)", target: "/Dest [3 0 R /XYZ 0 750 0]", children: [
            { title: "(Section <b>1.1</b> & more)", target: "/Dest [3 0 R /Fit]" }
        ] },
        { title: "(Named)", target: "/Dest (chapter-2)" },
        { title: "(Missing)", target: "/Dest (no-such-destination)" },
        { title: "( \\tSpaced\\tout  )", target: "/Dest [4 0 R /Fit]" },
        { title: "(Link)", target: "/A << /S /URI /URI (https://example.com) >>" },
        { title: utf16("Résumé"), target: "/A << /S /GoTo /D [4 0 R /Fit] >>", children: [
            { title: "(No destination)", target: "" },
            { title: "(\\200 Bullet \\205 dash)", target: "/Dest [3 0 R /Fit]" }
        ] },
        { title: `(${"a".repeat(499)} b)`, target: "/Dest [5 0 R /Fit]" },
        { title: "(Summary)", target: "/Dest [4 0 R /Fit]" },
        { title: "(Summary)", target: "/Dest [5 0 R /Fit]" },
        chain
    ];

    /** Writes `siblings` under `parent`, and returns the numbers of the first and the last. */
    function writeEntries(siblings: Entry[], parent: number): [ number, number ] {
        const numbers = siblings.map(() => {
            add("");
            return objects.length;
        });
        for (const [ index, entry ] of siblings.entries()) {
            const links = [
                `/Parent ${ref(parent)}`,
                index > 0 ? `/Prev ${ref(numbers[index - 1])}` : "",
                index < siblings.length - 1 ? `/Next ${ref(numbers[index + 1])}` : ""
            ];
            if (entry.children) {
                const [ first, last ] = writeEntries(entry.children, numbers[index]);
                links.push(`/First ${ref(first)} /Last ${ref(last)} /Count ${entry.children.length}`);
            }
            objects[numbers[index] - 1] = `<< /Title ${entry.title} ${entry.target} ${links.join(" ")} >>`;
        }
        return [ numbers[0], numbers[numbers.length - 1] ];
    }

    const [ first, last ] = writeEntries(entries, 6);
    objects[5] = `<< /Type /Outlines /First ${ref(first)} /Last ${ref(last)} /Count ${entries.length} >>`;

    let out = "%PDF-1.7\n";
    const offsets: number[] = [];
    for (const [ index, body ] of objects.entries()) {
        offsets.push(out.length);
        out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
}
