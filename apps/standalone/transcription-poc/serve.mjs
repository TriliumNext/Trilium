// Serves the prototype on http://localhost:5555, on an origin of its own so that standalone's
// service worker never sits between the page and a model download.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const PORT = 5555;
const ROOT = import.meta.dirname;
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream"
};

createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const path = normalize(join(ROOT, pathname === "/" ? "index.html" : pathname));
    if (!path.startsWith(ROOT)) {
        response.writeHead(403).end();
        return;
    }

    try {
        const info = await stat(path);
        response.writeHead(200, {
            "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
            "Content-Length": info.size,
            // Matches standalone, which is not cross-origin isolated either.
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cache-Control": "no-store"
        });
        createReadStream(path).pipe(response);
    } catch {
        response.writeHead(404).end();
    }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
