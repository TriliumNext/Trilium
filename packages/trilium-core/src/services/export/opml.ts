import type { Response } from "express";

import { getBecca } from "../../becca/becca.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type TaskContext from "../task_context.js";
import { getContentDisposition } from "../utils/index.js";

function exportToOpml(taskContext: TaskContext<"export">, branch: BBranch, res: Response) {
    const note = branch.getNote();

    function exportNoteInner(branchId: string) {
        const branch = getBecca().getBranch(branchId);
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
        const preparedTitle = escapeXmlAttribute(title);
        const preparedContent = note.hasStringContent() ? escapeXmlAttribute(note.getContent() as string) : "";

        res.write(`<outline text="${preparedTitle}" _note="${preparedContent}">\n`);

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
<opml version="2.0">
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

function escapeXmlAttribute(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export default {
    exportToOpml
};
