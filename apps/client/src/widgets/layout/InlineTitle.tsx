import "./InlineTitle.css";

import { NoteType } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChild } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Trans } from "react-i18next";

import { ViewScope } from "../../services/link";
import { formatDateTime } from "../../utils/formatters";
import NoteIcon from "../note_icon";
import NoteTitleWidget from "../note_title";
import { useNoteContext, useNoteProperty, useStaticTooltip } from "../react/hooks";
import { joinElements } from "../react/react_utils";
import { useNoteMetadata } from "../ribbon/NoteInfoTab";

const supportedNoteTypes = new Set<NoteType>([
    "text", "code"
]);

export default function InlineTitle() {
    const { note, parentComponent, viewScope } = useNoteContext();
    const type = useNoteProperty(note, "type");
    const [ shown, setShown ] = useState(shouldShow(note?.noteId, type, viewScope));
    const containerRef = useRef<HTMLDivElement>(null);
    const [ titleHidden, setTitleHidden ] = useState(false);

    useLayoutEffect(() => {
        setShown(shouldShow(note?.noteId, type, viewScope));
    }, [ note, type, viewScope ]);

    useLayoutEffect(() => {
        if (!shown) return;

        const titleRow = parentComponent.$widget[0].closest(".note-split")?.querySelector(":scope > .title-row");
        if (!titleRow) return;

        titleRow.classList.toggle("hide-title", true);
        const observer = new IntersectionObserver((entries) => {
            titleRow.classList.toggle("hide-title", entries[0].isIntersecting);
            setTitleHidden(!entries[0].isIntersecting);
        }, {
            threshold: 0.85
        });
        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => {
            titleRow.classList.remove("hide-title");
            observer.disconnect();
        };
    }, [ shown, parentComponent ]);

    return (
        <div
            ref={containerRef}
            className={clsx("inline-title", !shown && "hidden")}
        >
            <div class={clsx("inline-title-row", titleHidden && "hidden")}>
                <NoteIcon />
                <div class="note-title-caption">
                    <NoteTitleWidget />
                    <NoteTitleDetails />
                </div>
            </div>
        </div>
    );
}

function shouldShow(noteId: string | undefined, type: NoteType | undefined, viewScope: ViewScope | undefined) {
    if (viewScope?.viewMode !== "default") return false;
    if (noteId?.startsWith("_options")) return true;
    return type && supportedNoteTypes.has(type);
}

//#region Title details
export function NoteTitleDetails() {
    const { note } = useNoteContext();
    const { metadata } = useNoteMetadata(note);
    const isHiddenNote = note?.noteId.startsWith("_");

    const items: ComponentChild[] = [
        (!isHiddenNote && metadata?.dateCreated &&
            <TextWithValue
                i18nKey="note_title.created_on"
                value={formatDateTime(metadata.dateCreated, "medium", "none")}
                valueTooltip={formatDateTime(metadata.dateCreated, "full", "long")}
            />),
        (!isHiddenNote && metadata?.dateModified &&
            <TextWithValue
                i18nKey="note_title.last_modified"
                value={formatDateTime(metadata.dateModified, "medium", "none")}
                valueTooltip={formatDateTime(metadata.dateModified, "full", "long")}
            />)
    ].filter(item => !!item);

    return items.length > 0 && (
        <div className="title-details">
            {joinElements(items, " • ")}
        </div>
    );
}

function TextWithValue({ i18nKey, value, valueTooltip }: {
    i18nKey: string;
    value: string;
    valueTooltip: string;
}) {
    const listItemRef = useRef<HTMLLIElement>(null);
    const tooltipConfig: Partial<Tooltip.Options> = useMemo(() => ({
        selector: "span.value",
        title: valueTooltip,
        popperConfig: { placement: "bottom" },
        animation: false
    }), [ valueTooltip ]);
    useStaticTooltip(listItemRef, tooltipConfig);

    return (
        <li ref={listItemRef}>
            <Trans
                i18nKey={i18nKey}
                components={{
                    Value: <span className="value">{value}</span> as React.ReactElement
                }}
            />
        </li>
    );
}
//#endregion


