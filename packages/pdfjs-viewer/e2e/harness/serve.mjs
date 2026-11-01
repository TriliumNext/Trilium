/**
 * Static server for the viewer e2e tests. Serves the built viewer (`dist/web`,
 * `dist/build`), the parent-page stub emulating the Trilium client, and a
 * generated blank PDF to annotate. Started by Playwright via the webServer
 * option in playwright.config.ts.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(HARNESS_DIR, "..", "..", "dist");
const PORT = Number(process.env.PDFJS_E2E_PORT ?? "8935");

const MIME_TYPES = {
    ".html": "text/html",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".gif": "image/gif",
    ".ftl": "text/plain",
    ".wasm": "application/wasm"
};

const samplePdf = buildBlankPdf();

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    try {
        if (url.pathname === "/parent.html") {
            return send(res, "text/html", await readFile(join(HARNESS_DIR, "parent.html")));
        }
        if (url.pathname === "/sample.pdf") {
            return send(res, "application/pdf", samplePdf);
        }
        if (url.pathname.startsWith("/web/") || url.pathname.startsWith("/build/")) {
            const relative = normalize(url.pathname).split(sep).filter(part => part && part !== "..").join(sep);
            const content = await readFile(join(DIST_DIR, relative));
            return send(res, MIME_TYPES[extname(relative)] ?? "application/octet-stream", content);
        }
        res.writeHead(404).end("Not found");
    } catch (e) {
        res.writeHead(e?.code === "ENOENT" ? 404 : 500).end(String(e?.message ?? e));
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`pdfjs-viewer e2e harness listening on http://127.0.0.1:${PORT}`);
});

function send(res, contentType, content) {
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
}

/** Builds a minimal single-page blank PDF (US Letter) for the tests to annotate. */
function buildBlankPdf() {
    const objects = [
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>\nendobj\n",
        "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n"
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    for (const object of objects) {
        offsets.push(pdf.length);
        pdf += object;
    }
    const xrefPosition = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`;
    return Buffer.from(pdf, "latin1");
}
