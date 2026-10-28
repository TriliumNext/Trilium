import { describe, expect, it } from "vitest";

import { formatHtml } from "./format_html.js";

describe("formatHtml", () => {
    it("puts each block on its own line, indenting the containers", () => {
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head>`
            + `<body><!-- note --><div class="ck-content"><h2>Plot</h2><p>A long paragraph stays on one line, however long it grows.</p>`
            + `<ul><li><p>one</p><ul><li>two</li></ul></li></ul>`
            + `<figure class="table"><table><tbody><tr><td>a</td><td>b</td></tr></tbody></table></figure></div></body></html>`;

        expect(formatHtml(html)).toBe([
            "<!DOCTYPE html>",
            `<html lang="en">`,
            "  <head>",
            `    <meta charset="utf-8">`,
            "    <title>T</title>",
            "  </head>",
            "  <body>",
            "    <!-- note -->",
            `    <div class="ck-content">`,
            "      <h2>Plot</h2>",
            "      <p>A long paragraph stays on one line, however long it grows.</p>",
            "      <ul>",
            "        <li>",
            "          <p>one</p>",
            "          <ul>",
            "            <li>two</li>",
            "          </ul>",
            "        </li>",
            "      </ul>",
            `      <figure class="table">`,
            "        <table>",
            "          <tbody>",
            "            <tr>",
            "              <td>a</td>",
            "              <td>b</td>",
            "            </tr>",
            "          </tbody>",
            "        </table>",
            "      </figure>",
            "    </div>",
            "  </body>",
            "</html>"
        ].join("\n"));
    });

    it("splits only at blocks, keeping each run of text and inline elements on one line", () => {
        expect(formatHtml(`<ul><li><a href="x">X</a><ul><li>n</li></ul></li><li><span>a</span><span>b</span></li></ul>`)).toBe([
            "<ul>",
            "  <li>",
            `    <a href="x">X</a>`,
            "    <ul>",
            "      <li>n</li>",
            "    </ul>",
            "  </li>",
            "  <li><span>a</span><span>b</span></li>",
            "</ul>"
        ].join("\n"));
        expect(formatHtml(`<div> a <b>b</b><!-- c --> c<p>p</p> d </div>`))
            .toBe([ "<div>", "  a <b>b</b><!-- c --> c", "  <p>p</p>", "   d", "</div>" ].join("\n"));
        expect(formatHtml(`text before <p>a block</p>`)).toBe("text before\n<p>a block</p>");
    });

    it("leaves the content of every element it does not split untouched", () => {
        const pre = `<pre><code class="language-js">  a\n\n  &lt;b&gt;</code></pre>`;
        const textarea = `<p><textarea>  keep\n  me</textarea></p>`;
        const paragraph = `<p class=x data-a="1 > 2" data-b='q"'>a&nbsp;&amp; <strong>b</strong>c<img src="a.png"></p>`;

        expect(formatHtml(`<div>${pre}${textarea}${paragraph}</div>`))
            .toBe(["<div>", `  ${pre}`, `  ${textarea}`, `  ${paragraph}`, "</div>"].join("\n"));
    });

    it("separates the attributes of every tag by one space, keeping their values as written", () => {
        expect(formatHtml(`<div   id="d"\n><p>See <a\n          class="reference-link"   href='a  b'\tdata-x = 1>x</a>.</p></div>`))
            .toBe([ `<div id="d">`, `  <p>See <a class="reference-link" href='a  b' data-x=1>x</a>.</p>`, "</div>" ].join("\n"));
        expect(formatHtml(`<pre   class="x"><code   class="y">  <b  >keep</b></code></pre>`))
            .toBe(`<pre class="x"><code   class="y">  <b  >keep</b></code></pre>`);
    });

    it("gives the same output when run on its own output", () => {
        const html = `<html><head><title>T</title></head><body><div><p>a</p>\n\n   <p>b</p></div></body></html>`;
        const formatted = formatHtml(html);

        expect(formatted).toBe([
            "<html>",
            "  <head>",
            "    <title>T</title>",
            "  </head>",
            "  <body>",
            "    <div>",
            "      <p>a</p>",
            "      <p>b</p>",
            "    </div>",
            "  </body>",
            "</html>"
        ].join("\n"));
        expect(formatHtml(formatted)).toBe(formatted);
    });
});
