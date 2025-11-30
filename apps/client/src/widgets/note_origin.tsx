import { t } from "../services/i18n";
import { useNoteContext, useTriliumEvent, useTriliumOption } from "./react/hooks";
import { useEffect, useState } from "preact/hooks";
import attributes from "../services/attributes";
import InfoBar from "./react/InfoBar";
import RawHtml from "./react/RawHtml";
import FNote from "../entities/fnote";

export default function OriginInfo() {
    const { note } = useNoteContext();
    const [link, setLink] = useState<string>();

    function refresh() {
        if (!note) return;
        const pageUrl = getPageUrl(note);
        if (!pageUrl) {
            setLink(undefined);
            return;
        }
        setLink(`<a href="${pageUrl}" class="external tn-link">${pageUrl}</a>`);
    }

    useEffect(refresh, [note]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().find((attr) => attr.type === "label" && attr.name?.toString() === "pageUrl" && attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    return (
        <InfoBar className="origin-info-widget" type="subtle" style={{ display: (!link) ? "none" : undefined }}>
            {link && (
                <RawHtml
                    html={`${t("note_properties.this_note_was_originally_taken_from")} ${link}`}
                />
            )}
        </InfoBar>
    )
}

function getPageUrl(note: FNote) {
    return note.getOwnedLabelValue("pageUrl");
}