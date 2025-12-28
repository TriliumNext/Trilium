"use strict";

import mimeTypes from "mime-types";
import path from "path";
import type { NoteType, TaskData } from "@triliumnext/commons";

const CODE_MIME_TYPES = new Set([
    "application/json",
    "message/http",
    "text/css",
    "text/html",
    "text/plain",
    "text/x-clojure",
    "text/x-csharp",
    "text/x-c++src",
    "text/x-csrc",
    "text/x-dockerfile",
    "text/x-elixir",
    "text/x-erlang",
    "text/x-feature",
    "text/x-go",
    "text/x-groovy",
    "text/x-haskell",
    "text/x-java",
    "text/x-kotlin",
    "text/x-lua",
    "text/x-markdown",
    "text/xml",
    "text/x-objectivec",
    "text/x-pascal",
    "text/x-perl",
    "text/x-php",
    "text/x-python",
    "text/x-ruby",
    "text/x-rustsrc",
    "text/x-scala",
    "text/x-sh",
    "text/x-sql",
    "text/x-stex",
    "text/x-swift",
    "text/x-typescript",
    "text/x-yaml"
]);

const CODE_MIME_TYPES_OVERRIDE = new Map<string, string>([
    ["application/javascript", "application/javascript;env=frontend"],
    ["application/x-javascript", "application/javascript;env=frontend"],
    // possibly later migrate to text/markdown as primary MIME
    ["text/markdown", "text/x-markdown"]
]);

// extensions missing in mime-db
const EXTENSION_TO_MIME = new Map<string, string>([
    [".c", "text/x-csrc"],
    [".cs", "text/x-csharp"],
    [".clj", "text/x-clojure"],
    [".erl", "text/x-erlang"],
    [".ex", "text/x-elixir"],
    [".exs", "text/x-elixir"],
    [".hrl", "text/x-erlang"],
    [".feature", "text/x-feature"],
    [".go", "text/x-go"],
    [".groovy", "text/x-groovy"],
    [".hs", "text/x-haskell"],
    [".lhs", "text/x-haskell"],
    [".http", "message/http"],
    [".kt", "text/x-kotlin"],
    [".m", "text/x-objectivec"],
    [".py", "text/x-python"],
    [".rb", "text/x-ruby"],
    [".scala", "text/x-scala"],
    [".swift", "text/x-swift"],
    [".ts", "text/x-typescript"],
    [".excalidraw", "application/json"],
    [".mermaid", "text/vnd.mermaid"],
    [".mmd", "text/vnd.mermaid"]
]);

/** @returns false if MIME is not detected */
function getMime(fileName: string) {
    const fileNameLc = fileName?.toLowerCase();

    if (fileNameLc === "dockerfile") {
        return "text/x-dockerfile";
    }

    const ext = path.extname(fileNameLc);
    const mimeFromExt = EXTENSION_TO_MIME.get(ext);

    return mimeFromExt || mimeTypes.lookup(fileNameLc);
}

function getType(options: TaskData<"importNotes">, mime: string): NoteType {
    const mimeLc = mime?.toLowerCase();

    switch (true) {
        case options?.textImportedAsText && ["text/html", "text/markdown", "text/x-markdown", "text/mdx"].includes(mimeLc):
            return "text";

        case options?.codeImportedAsCode && CODE_MIME_TYPES.has(mimeLc):
            return "code";

        case mime.startsWith("image/"):
            return "image";

        case mime === "text/vnd.mermaid":
            return "mermaid";

        default:
            return "file";
    }
}

function normalizeMimeType(mime: string) {
    const mimeLc = mime.toLowerCase();

    //prettier-ignore
    return CODE_MIME_TYPES.has(mimeLc)
        ? mimeLc
        : CODE_MIME_TYPES_OVERRIDE.get(mimeLc);
}

export default {
    getMime,
    getType,
    normalizeMimeType
};
