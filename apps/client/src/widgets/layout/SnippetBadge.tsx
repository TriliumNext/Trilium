import { useEffect, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import mimeTypesService from "../../services/mime_types";
import { Badge } from "../react/Badge";
import { useNoteContext, useNoteProperty, useTriliumEvent } from "../react/hooks";

interface SnippetInfo {
    /** Human-readable kind of snippet, e.g. "Text", "Markdown", "CSS". */
    typeName: string;
    icon: string;
}

/**
 * Informational badge marking a note as a reusable snippet and naming its kind — e.g. "CSS snippet"
 * rather than just a generic code note, and "Text snippet" so a rich-text snippet is distinguishable
 * from an ordinary text note. Read-only; enabling/disabling is not offered.
 */
export function SnippetBadge() {
    const { note } = useNoteContext();
    const info = useSnippetInfo(note);

    return (info &&
        <Badge
            className="snippet-badge"
            icon={info.icon}
            text={t("snippet_badge.label", { type: info.typeName })}
            tooltip={t("snippet_badge.tooltip")}
        />
    );
}

function useSnippetInfo(note: FNote | null | undefined) {
    const [ info, setInfo ] = useState<SnippetInfo | null>(null);
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");

    function refresh() {
        if (!note || !(note.hasLabel("snippet") || note.hasLabel("textSnippet"))) {
            setInfo(null);
            return;
        }

        // Rich-text snippets are plain text notes; name them "Text" rather than via their text/html MIME.
        if (note.type === "text") {
            setInfo({ typeName: t("snippet_badge.type_text"), icon: "bx bx-align-left" });
            return;
        }

        // A generic (plain-text) or unrecognized code snippet reads as "Code" — clearer than "Plain
        // text" (which collides with "Text") and matching the "Code snippet" template. A recognized
        // language keeps its own name and icon (e.g. "CSS snippet").
        const mimeType = mimeTypesService.getMimeTypes().find((mt) => mt.mime === note.mime);
        if (!mimeType || note.mime === "text/plain") {
            setInfo({ typeName: t("snippet_badge.type_code"), icon: "bx bx-code" });
            return;
        }
        setInfo({ typeName: mimeType.title, icon: mimeType.icon ?? "bx bx-code" });
    }

    useEffect(refresh, [ note, noteType, noteMime ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    return info;
}
