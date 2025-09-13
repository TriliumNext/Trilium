"use strict";

import { getContentDisposition, stripTags } from "../utils.js";
import becca from "../../becca/becca.js";
import type TaskContext from "../task_context.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type { Response } from "express";

function exportToOpml(taskContext: TaskContext<"export">, branch: BBranch, version: string, res: Response) {
    if (!["1.0", "2.0"].includes(version)) {
        throw new Error(`Unrecognized OPML version ${version}`);
    }

    const opmlVersion = parseInt(version);

    const note = branch.getNote();

    function exportNoteInner(branchId: string) {
        const branch = becca.getBranch(branchId);
        if (!branch) {
            throw new Error("Unable to find branch.");
        }

        const note = branch.getNote();
        if (!note) {
            throw new Error("Unable to find note.");
        }

        if (note.hasOwnedLabel("excludeFromExport")) {
            return;
        }

        const title = `${branch.prefix ? `${branch.prefix} - ` : ""}${note.title}`;

        if (opmlVersion === 1) {
            const preparedTitle = escapeXmlAttribute(title);
            const preparedContent = note.hasStringContent() ? prepareText(note.getContent() as string) : "";

            res.write(`<outline title="${preparedTitle}" text="${preparedContent}">\n`);
        } else if (opmlVersion === 2) {
            const preparedTitle = escapeXmlAttribute(title);
            const preparedContent = note.hasStringContent() ? escapeXmlAttribute(note.getContent() as string) : "";

            res.write(`<outline text="${preparedTitle}" _note="${preparedContent}">\n`);
        } else {
            throw new Error(`Unrecognized OPML version ${opmlVersion}`);
        }

        taskContext.increaseProgressCount();

        for (const child of note.getChildBranches()) {
            if (child?.branchId) {
                exportNoteInner(child.branchId);
            }
        }

        res.write("</outline>");
    }

    const filename = `${branch.prefix ? `${branch.prefix} - ` : ""}${note.title}.opml`;

    res.setHeader("Content-Disposition", getContentDisposition(filename));
    res.setHeader("Content-Type", "text/x-opml");

    res.write(`<?xml version="1.0" encoding="UTF-8"?>
<opml version="${version}">
<head>
<title>Trilium export</title>
</head>
<body>`);

    if (branch.branchId) {
        exportNoteInner(branch.branchId);
    }

    res.write(`</body>
</opml>`);
    res.end();

    taskContext.taskSucceeded(null);
}

function prepareText(text: string) {
    const newLines = text.replace(/(<p[^>]*>|<br\s*\/?>)/g, "\n").replace(/&nbsp;/g, " "); // nbsp isn't in XML standard (only HTML)

    const stripped = stripTags(newLines);

    const escaped = escapeXmlAttribute(stripped);

    return escaped.replace(/\n/g, "&#10;");
}

function escapeXmlAttribute(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export default {
    exportToOpml
};
