import "./shared_info.css";

import { useEffect, useState } from "preact/hooks";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { t } from "../services/i18n";
import { buildShareLink } from "../services/share_link";
import { escapeHtml, isElectron, isMobileApp, isStandalone } from "../services/utils";
import HelpButton from "./react/HelpButton";
import { useNoteContext, useTriliumEvent, useTriliumOption } from "./react/hooks";
import InfoBar from "./react/InfoBar";
import RawHtml from "./react/RawHtml";

export default function SharedInfo() {
    const { note } = useNoteContext();
    const { scope, link } = useShareInfo(note);

    return (
        <InfoBar className="shared-info-widget" type="subtle" style={{display: (!link) ? "none" : undefined}}>
            {link && <RawHtml html={t(SCOPE_MESSAGES[scope], { link, format: t("export.format_share_name") })} />}
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

        const link = buildShareLink(getShareId(note), syncServerHost);

        setLink(buildShareLinkHtml(link));
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
        scope: getShareScope({
            isElectron: isElectron(),
            isStandalone: !!isStandalone,
            isMobileApp: isMobileApp(),
            syncServerHost
        })
    };
}

/**
 * Where a shared note can be opened from. `local` is the desktop app without a sync server, which
 * serves the page on the loopback address. `preview` is the standalone build without a sync server,
 * which renders the page in its own service worker, so only this browser can open it. `export-only`
 * is the mobile app without a sync server: its link opens nowhere, so the static export is the only
 * way to publish the note. A server cannot tell whether it is reachable from outside, so it always
 * reports `public`.
 */
export function getShareScope({ isElectron, isStandalone, isMobileApp, syncServerHost }: {
    isElectron: boolean;
    isStandalone: boolean;
    isMobileApp: boolean;
    syncServerHost: string | null | undefined;
}): ShareScope {
    if (syncServerHost) {
        return "public";
    }

    if (isMobileApp) {
        return "export-only";
    }

    if (isStandalone) {
        return "preview";
    }

    return isElectron ? "local" : "public";
}

export type ShareScope = "public" | "local" | "preview" | "export-only";

const SCOPE_MESSAGES: Record<ShareScope, string> = {
    public: "shared_info.shared_publicly",
    local: "shared_info.shared_locally",
    preview: "shared_info.shared_preview",
    "export-only": "shared_info.shared_export_only"
};

export function buildShareLinkHtml(link: string) {
    const escapedLink = escapeHtml(link);

    return `<a href="${escapedLink}" class="external tn-link">${escapedLink}</a>`;
}

function getShareId(note: FNote) {
    if (note.hasOwnedLabel("shareRoot")) {
        return "";
    }

    return note.getOwnedLabelValue("shareAlias") || note.noteId;
}
