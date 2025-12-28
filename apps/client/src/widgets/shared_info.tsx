import "./shared_info.css";

import { useEffect, useState } from "preact/hooks";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { t } from "../services/i18n";
import { isElectron } from "../services/utils";
import HelpButton from "./react/HelpButton";
import { useNoteContext, useTriliumEvent, useTriliumOption } from "./react/hooks";
import InfoBar from "./react/InfoBar";
import RawHtml from "./react/RawHtml";

export default function SharedInfo() {
    const { note } = useNoteContext();
    const { isSharedExternally, link } = useShareInfo(note);

    return (
        <InfoBar className="shared-info-widget" type="subtle" style={{display: (!link) ? "none" : undefined}}>
            {link && (
                <RawHtml html={isSharedExternally
                    ? t("shared_info.shared_publicly", { link })
                    : t("shared_info.shared_locally", { link })} />
            )}
            <HelpButton helpPage="R9pX4DGra2Vt" style={{ width: "24px", height: "24px" }} />
        </InfoBar>
    );
}

export function useShareInfo(note: FNote | null | undefined) {
    const [ link, setLink ] = useState<string>();
    const [ linkHref, setLinkHref ] = useState<string>();
    const [ syncServerHost ] = useTriliumOption("syncServerHost");

    function refresh() {
        if (!note) return;
        if (note.noteId === "_share" || !note?.hasAncestor("_share")) {
            setLink(undefined);
            setLinkHref(undefined);
            return;
        }

        let link;
        const shareId = getShareId(note);

        if (syncServerHost) {
            link = new URL(`/share/${shareId}`, syncServerHost).href;
        } else {
            let host = location.host;
            if (host.endsWith("/")) {
                // seems like IE has trailing slash
                // https://github.com/zadam/trilium/issues/3782
                host = host.substring(0, host.length - 1);
            }

            link = `${location.protocol}//${host}${location.pathname}share/${shareId}`;
        }

        setLink(`<a href="${link}" class="external tn-link">${link}</a>`);
        setLinkHref(link);
    }

    useEffect(refresh, [ note, syncServerHost ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().find((attr) => attr.name?.startsWith("_share") && attributes.isAffecting(attr, note))) {
            refresh();
        } else if (loadResults.getBranchRows().find((branch) => branch.noteId === note?.noteId)) {
            refresh();
        }
    });

    return {
        link,
        linkHref,
        isSharedExternally: !isElectron() || !!syncServerHost    // on server we can't reliably detect if the note is shared locally or available publicly.
    };
}

function getShareId(note: FNote) {
    if (note.hasOwnedLabel("shareRoot")) {
        return "";
    }

    return note.getOwnedLabelValue("shareAlias") || note.noteId;
}
