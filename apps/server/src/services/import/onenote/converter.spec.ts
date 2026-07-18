import { SANITIZER_DEFAULT_ALLOWED_TAGS } from "@triliumnext/commons";
import { cls, options as optionService } from "@triliumnext/core";
import { parse } from "node-html-parser";
import { beforeAll, describe, expect, it } from "vitest";

import converter from "./converter.js";

beforeAll(() => {
    // The shared fixture DB predates `<u>` being allowlisted; align the sanitizer's allowed tags with
    // the current default so the test asserts the end result a fresh install would store.
    cls.init(() => optionService.setOption("allowedHtmlTags", JSON.stringify(SANITIZER_DEFAULT_ALLOWED_TAGS)));
});

// A representative OneNote page as returned by the Graph API: margin-0 paragraphs, a numbered and
// two bulleted lists, a trailing empty list item, and bare block-level <br> elements that OneNote
// uses for vertical spacing between blocks.
const SAMPLE = `<html lang="en-US">
    <head>
        <title>2020-09-02. Customer Daily</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="created" content="2020-09-02T09:37:00.0000000" />
    </head>
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:576px">
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold">Participants:</span></p>
            <ol>
                <li>Participant 1</li>
                <li>Participant 2</li>
            </ol>
            <br />
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold">Agenda:</span></p>
            <ul>
                <li>ACME-1234</li>
                <li>ACME-1235</li>
                <li><br />
                </li>
            </ul>
            <br />
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold">Discussion:</span></p>
            <ul>
                <li>Subject 1</li>
                <li>Subject 2</li>
            </ul>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): bold/italic/underline are carried as inline styles on
// <span>, individually and combined on a single span.
const FORMATTING_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:54px;top:134px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Normal text.</p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold">Bold text.</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-style:italic">Italic text.</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="text-decoration:underline">Under line text.</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold;font-style:italic">Bold and italic text.</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold;text-decoration:underline">Bold and underline text</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-weight:bold;font-style:italic;text-decoration:underline">Bold, italic and underline text</span></p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): subscript/superscript are real <sub>/<sup> tags, while
// strikethrough is carried as a text-decoration inline style.
const SUPERSCRIPT_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Normal <sub>sub</sub> <sup>sup</sup> <span style="text-decoration:line-through">strikethrough</span></p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): highlight and font color use CSS *named* colors, which the
// sanitizer's colorRegex (hex/rgb/hsl only) would otherwise strip.
const HIGHLIGHT_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="background-color:yellow">Yellow</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:white;background-color:fuchsia">Magenta</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:black;background-color:silver">Light Gray</span></p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): named styles are mostly real tags (h1-h6, cite) plus inline
// styling. The sanitizer demotes a contiguous heading run by one level (h1 is reserved for the note
// title), and font-style:italic is handled by convertInlineFormatting.
const STYLES_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <h1 style="font-size:16pt;color:#1e4e79;margin-top:0pt;margin-bottom:0pt">Heading 1</h1>
            <h2 style="font-size:14pt;color:#2e75b5;margin-top:0pt;margin-bottom:0pt">Heading 2</h2>
            <h3 style="font-size:12pt;color:#1f3763;margin-top:0pt;margin-bottom:0pt">Heading 3</h3>
            <h4 style="font-size:12pt;color:#2f5496;font-style:italic;margin-top:0pt;margin-bottom:0pt">Heading 4</h4>
            <h5 style="color:#2e75b5;margin-top:0pt;margin-bottom:0pt">Heading 5</h5>
            <h6 style="color:#2e75b5;font-style:italic;margin-top:0pt;margin-bottom:0pt">Heading 6</h6>
            <cite style="font-size:9pt;color:#595959;margin-top:0pt;margin-bottom:0pt">Citation</cite>
            <p style="color:#595959;font-style:italic;margin-top:0pt;margin-bottom:0pt">Quote</p>
            <p style="font-family:Calibri Light;font-size:20pt;margin-top:0pt;margin-bottom:0pt">Title</p>
            <p style="font-family:Consolas;margin-top:0pt;margin-bottom:0pt">Code</p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): the full font-size scale, from 8pt up to 72pt on an 11pt
// base. OneNote carries each size as a `font-size:Npt` inline style on a <span>.
const FONT_SIZES_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:131px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:8pt">Smallest (8)</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:9pt">Still small (9)</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:10pt">Size 10</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt">Size 11</p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:12pt">Size 12</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:14pt">Size 14</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:16pt">Size 16</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:18pt">Size 18</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:20pt">Size 20</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:24pt">Size 24</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:26pt">Size 26</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:28pt">Size 28</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:36pt">Size 36</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:48pt">Size 48</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="font-size:72pt">Size 72</span></p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): to-do items are paragraphs tagged with data-tag="to-do" /
// "to-do:completed", not list markup.
const TAGS_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p data-tag="to-do" style="margin-top:0pt;margin-bottom:0pt">To do</p>
            <p data-tag="to-do" style="margin-top:0pt;margin-bottom:0pt">Another todo</p>
            <p data-tag="to-do:completed" style="margin-top:0pt;margin-bottom:0pt">Completed todo</p>
            <p data-tag="to-do" style="margin-top:0pt;margin-bottom:0pt">Another non-completed TODO</p>
        </div>
    </body>
</html>`;

// Real OneNote source (web-OneNote Graph export): the decorative (non-checkbox) note tags. Each is a
// paragraph carrying a `data-tag` that OneNote renders as an icon — we render it as an emoji prefix.
const EMOJI_TAGS_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p data-tag="important" style="margin-top:0pt;margin-bottom:0pt">Important</p>
            <p data-tag="question" style="margin-top:0pt;margin-bottom:0pt">Question</p>
            <p data-tag="idea" style="margin-top:0pt;margin-bottom:0pt">Idea</p>
            <p data-tag="password" style="margin-top:0pt;margin-bottom:0pt">Password</p>
            <p data-tag="phone-number" style="margin-top:0pt;margin-bottom:0pt">Phone number</p>
        </div>
    </body>
</html>`;

// Real OneNote source (web-OneNote Graph export): checkbox note tags other than plain to-do
// (priorities, discussions, meetings, client requests). All render as task-list items, and the
// `:completed` status checks the box.
const CHECKBOX_TAGS_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p data-tag="to-do-priority-1" style="margin-top:0pt;margin-bottom:0pt">Priority 1</p>
            <p data-tag="schedule-meeting:completed" style="margin-top:0pt;margin-bottom:0pt">Schedule meeting</p>
            <p data-tag="discuss-with-manager" style="margin-top:0pt;margin-bottom:0pt">Discuss with Manager</p>
            <p data-tag="client-request" style="margin-top:0pt;margin-bottom:0pt">Client Request</p>
        </div>
    </body>
</html>`;

// Real OneNote source (web-OneNote Graph export): a paragraph can carry several comma-separated tags
// at once — a checkbox tag combined with decorative ones, or several decorative ones together.
const MULTI_TAGS_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p data-tag="to-do,important,question" style="margin-top:0pt;margin-bottom:0pt">Todo plus star plus question</p>
            <p data-tag="movie-to-see,book-to-read" style="margin-top:0pt;margin-bottom:0pt">Movie and book</p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): a free-form page with four absolutely-positioned text boxes
// whose document order differs from their visual (top-to-bottom) reading order.
const ALIGNMENT_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:512px;top:210px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">The quick</p>
        </div>
        <div style="position:absolute;left:318px;top:333px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Brown fox</p>
        </div>
        <div style="position:absolute;left:579px;top:441px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Jumps over the lazy dog</p>
        </div>
        <div style="position:absolute;left:222px;top:277px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">And then it jumps again.</p>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): an inline image and a file attachment, both served from
// authenticated Graph `/resources/{id}/$value` URLs. The image carries an extra full-resolution
// `data-fullres-src`; the attachment is an <object> the sanitizer would otherwise drop entirely.
const RESOURCE_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <object data-attachment="HelloWorld.txt" type="text/plain" data="https://graph.microsoft.com/v1.0/users('me')/onenote/resources/0-aaa!1-BBB!sccc/$value" />
            <br />
        </div>
        <div style="position:absolute;left:569px;top:116px;width:624px">
            <img width="480" height="441" src="https://graph.microsoft.com/v1.0/users('me')/onenote/resources/0-ddd!1-BBB!sccc/$value" data-src-type="image/png" data-fullres-src="https://graph.microsoft.com/v1.0/users('me')/onenote/resources/0-eee!1-BBB!sccc/$value" data-fullres-src-type="image/png" />
            <br />
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): OneNote puts the list marker type on each <li> and wraps
// item text in a margin-0 <p>. The marker type belongs on the <ul>/<ol> (CKEditor's representation),
// and OneNote's lower-alpha/upper-alpha map to CKEditor's lower-latin/upper-latin.
const LISTS_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Normal:</p>
            <br />
            <ul>
                <li><p style="margin-top:0pt;margin-bottom:0pt">Normal bullet</p>
                <ul>
                    <li style="list-style-type:circle"><p style="margin-top:0pt;margin-bottom:0pt">Sub-bullet</p></li>
                </ul>
                </li>
            </ul>
            <p style="margin-top:0pt;margin-bottom:0pt">Hollow:</p>
            <ul>
                <li style="list-style-type:circle">Hollow</li>
            </ul>
            <p style="margin-top:0pt;margin-bottom:0pt">Alpha:</p>
            <ol>
                <li value="1" style="list-style-type:lower-alpha">A</li>
                <li style="list-style-type:lower-alpha">B</li>
            </ol>
            <p style="margin-top:0pt;margin-bottom:0pt">Roman:</p>
            <ol>
                <li value="1" style="list-style-type:upper-roman">A</li>
            </ol>
        </div>
    </body>
</html>`;

// Real OneNote source (debug-captured): a table with visible borders and one with hidden borders
// (border:0px). OneNote carries borders as a `border` shorthand + border-collapse.
const TABLE_SAMPLE = `<html lang="en-US">
    <body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
        <div style="position:absolute;left:48px;top:115px;width:624px">
            <table style="border:1px solid;border-collapse:collapse">
                <tr><td style="background-color:#d8d8d8;border:1px solid">A</td><td style="border:1px solid">B</td></tr>
                <tr><td style="border:1px solid">1</td><td style="border:1px solid">Content</td></tr>
            </table>
        </div>
        <div style="position:absolute;left:211px;top:382px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt">Hidden borders</p>
            <br />
            <table style="border:0px">
                <tr><td style="background-color:#d8d8d8;border:0px">A</td><td style="border:0px">B</td></tr>
                <tr><td style="border:0px">1</td><td style="border:0px">Content</td></tr>
            </table>
        </div>
    </body>
</html>`;

// Tests assert the end result (the HTML actually stored on the note, i.e. after sanitization).
describe("convertPageHtml", () => {
    it("strips OneNote's block-level <br> spacing and empty list items, keeping real content", () => {
        const out = converter.convertPageHtml(SAMPLE);
        const root = parse(out);

        // The two bare <br> after </ol>/</ul> and the <br> in the empty <li> are all gone.
        expect(root.querySelectorAll("br")).toHaveLength(0);

        // The trailing empty Agenda item is removed; the three lists keep their real items.
        const ol = root.querySelectorAll("ol");
        const uls = root.querySelectorAll("ul");
        expect(ol).toHaveLength(1);
        expect(uls).toHaveLength(2);
        expect(ol[0].querySelectorAll("li")).toHaveLength(2); // Participants 1-2
        expect(uls[0].querySelectorAll("li")).toHaveLength(2); // Agenda: ACME-1234/1235 (empty dropped)
        expect(uls[1].querySelectorAll("li")).toHaveLength(2); // Discussion 1-2

        // Headings and list contents survive.
        expect(out).toContain("Participants:");
        expect(out).toContain("Participant 1");
        expect(out).toContain("ACME-1234");
        expect(out).toContain("Discussion:");
        expect(out).toContain("Subject 2");
    });

    it("keeps genuine soft line breaks inside a paragraph", () => {
        const out = converter.convertPageHtml(`<body><p>line one<br />line two</p></body>`);
        expect(parse(out).querySelectorAll("br")).toHaveLength(1);
    });

    it("orders absolutely-positioned text boxes by position (top, then left)", () => {
        const out = converter.convertPageHtml(ALIGNMENT_SAMPLE);
        const paragraphs = parse(out).querySelectorAll("p").map((p) => p.textContent.trim());
        expect(paragraphs).toEqual([
            "The quick",
            "And then it jumps again.",
            "Brown fox",
            "Jumps over the lazy dog"
        ]);
    });

    it("moves OneNote list marker types from <li> onto the list, mapping alpha to latin", () => {
        const out = converter.convertPageHtml(LISTS_SAMPLE);
        const root = parse(out);
        const uls = root.querySelectorAll("ul"); // [Normal-top, Normal-nested, Hollow]
        const ols = root.querySelectorAll("ol"); // [Alpha, Roman]

        // Top-level list takes its marker from the first item; nested list drops it; default = no style.
        expect(uls[0].getAttribute("style") ?? "").not.toContain("list-style-type"); // Normal (default)
        expect(uls[1].getAttribute("style") ?? "").not.toContain("list-style-type"); // nested → dropped
        expect(uls[2].getAttribute("style")).toContain("list-style-type:circle"); // Hollow
        expect(ols[0].getAttribute("style")).toContain("list-style-type:lower-latin"); // lower-alpha → latin
        expect(ols[1].getAttribute("style")).toContain("list-style-type:upper-roman");

        // The per-item markers and the wrapping <p> are gone.
        expect(root.querySelectorAll("li").every((li) => !(li.getAttribute("style") ?? "").includes("list-style-type"))).toBe(true);
        expect(root.querySelectorAll("li p")).toHaveLength(0);
        expect(out).toContain("Normal bullet");
    });

    it("drops visible table borders and maps OneNote's hidden (0px) borders to transparent", () => {
        const out = converter.convertPageHtml(TABLE_SAMPLE);
        const root = parse(out);
        const tables = root.querySelectorAll("table");

        // Visible-border table: border shorthand / collapse dropped (CKEditor draws default borders).
        expect(tables[0].getAttribute("style") ?? "").not.toContain("border");
        // Hidden-border table: border:0px -> transparent border.
        expect(tables[1].getAttribute("style")).toContain("border-color:transparent");
        expect(tables[1].getAttribute("style")).toContain("border-style:solid");

        const visibleCells = tables[0].querySelectorAll("td");
        expect(visibleCells[0].getAttribute("style")).toContain("background-color:#d8d8d8");
        expect(visibleCells[0].getAttribute("style") ?? "").not.toContain("border");

        const hiddenCells = tables[1].querySelectorAll("td");
        expect(hiddenCells[0].getAttribute("style")).toContain("background-color:#d8d8d8");
        expect(hiddenCells[0].getAttribute("style")).toContain("border-color:transparent");
        expect(hiddenCells[1].getAttribute("style")).toContain("border-color:transparent");

        expect(out).not.toContain("border:0px");
        expect(out).not.toContain("border-collapse");
    });

    it("converts OneNote to-do tags into a Trilium task list", () => {
        const out = converter.convertPageHtml(TAGS_SAMPLE);
        const root = parse(out);

        // Consecutive to-do paragraphs become one CKEditor todo-list, not literal "[ ]" text.
        expect(root.querySelectorAll("ul.todo-list")).toHaveLength(1);
        expect(root.querySelectorAll("li")).toHaveLength(4);
        expect(root.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(4);
        expect(root.querySelectorAll("span.todo-list__label__description")).toHaveLength(4);

        // Exactly the one completed item is checked.
        expect(root.querySelectorAll("input[checked]")).toHaveLength(1);

        expect(out).toContain("Completed todo");
        expect(out).not.toContain("[ ]");
        expect(out).not.toContain("[x]");
    });

    it("treats every checkbox-style tag (priority/meeting/discussion/request) as a task item", () => {
        const out = converter.convertPageHtml(CHECKBOX_TAGS_SAMPLE);
        const root = parse(out);

        // All four checkbox-style tags collapse into a single task list with one item each.
        expect(root.querySelectorAll("ul.todo-list")).toHaveLength(1);
        expect(root.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(4);
        // Only the schedule-meeting:completed item is checked.
        expect(root.querySelectorAll("input[checked]")).toHaveLength(1);
        // Each meaningful checkbox tag keeps an inner emoji alongside the checkbox.
        expect(out).toContain("1️⃣ Priority 1");
        expect(out).toContain("📅 Schedule meeting");
        expect(out).toContain("🗣️ Discuss with Manager");
        expect(out).toContain("📋 Client Request");
        // The raw data-tag attribute is consumed, not left on the output.
        expect(out).not.toContain("data-tag");
    });

    it("renders decorative tags as an emoji prefix, leaving the paragraph in place", () => {
        const out = converter.convertPageHtml(EMOJI_TAGS_SAMPLE);
        const root = parse(out);

        // No checkbox tags here, so nothing becomes a task list.
        expect(root.querySelectorAll("ul.todo-list")).toHaveLength(0);
        expect(root.querySelectorAll("p")).toHaveLength(5);
        expect(out).toContain("⭐ Important");
        expect(out).toContain("❓ Question");
        expect(out).toContain("💡 Idea");
        expect(out).toContain("🔑 Password");
        expect(out).toContain("📞 Phone number");
        expect(out).not.toContain("data-tag");
    });

    it("supports multiple comma-separated tags on one paragraph", () => {
        const out = converter.convertPageHtml(MULTI_TAGS_SAMPLE);
        const root = parse(out);

        // The checkbox tag turns its paragraph into a task item, prefixed with the decorative emoji.
        expect(root.querySelectorAll("ul.todo-list")).toHaveLength(1);
        expect(root.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(1);
        expect(root.querySelectorAll("input[checked]")).toHaveLength(0);
        expect(out).toContain("⭐❓ Todo plus star plus question");

        // The decorative-only paragraph stays a <p>, prefixed with both emoji.
        expect(out).toContain("🎬📚 Movie and book");
    });

    it("normalizes OneNote resource references so the importer can rewrite them", () => {
        const out = converter.convertPageHtml(RESOURCE_SAMPLE);
        const root = parse(out);

        // The <object> attachment (which the sanitizer would drop) becomes a marker anchor carrying the
        // Graph URL, mime and filename.
        const anchor = root.querySelector("a.onenote-attachment");
        expect(anchor?.getAttribute("href")).toContain("/resources/0-aaa!1-BBB!sccc/$value");
        expect(anchor?.getAttribute("data-mime")).toBe("text/plain");
        expect(anchor?.textContent).toBe("HelloWorld.txt");
        expect(out).not.toContain("<object");

        // The image keeps its display-resolution src but sheds the extra full-resolution data-* URLs.
        const img = root.querySelector("img");
        expect(img?.getAttribute("src")).toContain("/resources/0-ddd!1-BBB!sccc/$value");
        expect(out).not.toContain("data-fullres-src");
        expect(out).not.toContain("data-src-type");
        expect(out).not.toContain("0-eee"); // the full-resolution resource id is gone
    });

    it("converts inline-style formatting (bold/italic/underline) to semantic tags", () => {
        const out = converter.convertPageHtml(FORMATTING_SAMPLE);
        expect(out).toContain("<strong>Bold text.</strong>");
        expect(out).toContain("<em>Italic text.</em>");
        expect(out).toContain("<u>Under line text.</u>");
        expect(out).toContain("<strong><em>Bold and italic text.</em></strong>");
        expect(out).toContain("<strong><u>Bold and underline text</u></strong>");
        expect(out).toContain("<strong><em><u>Bold, italic and underline text</u></em></strong>");
    });

    it("preserves superscript/subscript and converts strikethrough", () => {
        const out = converter.convertPageHtml(SUPERSCRIPT_SAMPLE);
        expect(out).toContain("<sub>sub</sub>");
        expect(out).toContain("<sup>sup</sup>");
        expect(out).toContain("<del>strikethrough</del>");
    });

    it("maps OneNote named highlight/font colors to hex so they survive sanitization", () => {
        const out = converter.convertPageHtml(HIGHLIGHT_SAMPLE);
        expect(out).toContain("background-color:#ffff00"); // yellow
        expect(out).toContain("color:#ffffff"); // white
        expect(out).toContain("background-color:#ff00ff"); // fuchsia
        expect(out).not.toContain("color:#000000"); // black is the default color and is stripped (see below)
        expect(out).toContain("background-color:#c0c0c0"); // silver kept even though its text was black
        expect(out).toContain("Yellow");
        expect(out).toContain("Magenta");
        expect(out).toContain("Light Gray");
    });

    // OneNote stamps an explicit color:#000000 (its automatic color, since a page is a white canvas) on
    // essentially every run of body text. Kept verbatim it overrides the theme foreground and renders as
    // unreadable black-on-dark under a dark theme, so default black is treated as "automatic" and dropped.
    it("strips OneNote's default black text color so text inherits the theme foreground", () => {
        const sample = `<html><body><div style="position:absolute;left:48px;top:115px;width:624px">
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:#000000">Default body text</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:#000000"><strong>Bold black</strong></span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:black">Named black</span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:#7030a0"><strong>Purple</strong></span></p>
            <p style="margin-top:0pt;margin-bottom:0pt"><span style="color:#000000;background-color:#ffff00">Black on yellow</span></p>
        </div></body></html>`;
        const out = converter.convertPageHtml(sample);

        // No black color survives, in either hex or named form.
        expect(out).not.toContain("color:#000000");
        expect(out).not.toContain("color:black");

        // The now-attribute-less spans are unwrapped, leaving the text (and its formatting) directly.
        expect(out).toContain("Default body text");
        expect(out).toContain("<strong>Bold black</strong>");
        expect(out).toContain("Named black");

        // Deliberate non-black colors are untouched.
        expect(out).toContain("color:#7030a0");
        // A span that also carries a highlight keeps the highlight but loses the black text color.
        expect(out).toContain("background-color:#ffff00");
        expect(out).toContain("Black on yellow");
    });

    it("keeps OneNote heading styles (level-shifted), cite, italic and font colors", () => {
        const out = converter.convertPageHtml(STYLES_SAMPLE);
        const root = parse(out);

        // Headings survive but shift down one level (h1 reserved for the note title).
        expect(root.querySelectorAll("h2")[0]?.textContent).toContain("Heading 1");
        expect(root.querySelectorAll("h3")[0]?.textContent).toContain("Heading 2");
        // Italic headings/quote get an <em> wrap; heading colors (hex) survive.
        expect(out).toContain("<em>Heading 4</em>");
        expect(out).toContain("<em>Quote</em>");
        expect(out).toContain("#1e4e79");
        // <cite> is allowlisted and kept.
        expect(root.querySelector("cite")?.textContent).toContain("Citation");
    });

    it("maps OneNote font sizes onto CKEditor's tiny/small/big/huge scale", () => {
        const out = converter.convertPageHtml(FONT_SIZES_SAMPLE);

        // 8pt -> tiny, 9-10pt -> small.
        expect(out).toContain(`<span class="text-tiny">Smallest (8)</span>`);
        expect(out).toContain(`<span class="text-small">Still small (9)</span>`);
        expect(out).toContain(`<span class="text-small">Size 10</span>`);

        // 11-16pt stay at the base size (no size class wrap).
        expect(out).toContain("Size 11");
        for (const text of ["Size 11", "Size 12", "Size 14", "Size 16"]) {
            expect(out).not.toMatch(new RegExp(`text-\\w+">${text}<`));
        }

        // 18-26pt -> big, 28pt and up -> huge.
        expect(out).toContain(`<span class="text-big">Size 18</span>`);
        expect(out).toContain(`<span class="text-big">Size 26</span>`);
        expect(out).toContain(`<span class="text-huge">Size 28</span>`);
        expect(out).toContain(`<span class="text-huge">Size 72</span>`);
    });

    it("maps the 20pt Title style to text-big and the Code style to <code>", () => {
        const out = converter.convertPageHtml(STYLES_SAMPLE);
        expect(out).toContain(`<span class="text-big">Title</span>`);
        expect(out).toContain("<code>Code</code>");
    });
});
