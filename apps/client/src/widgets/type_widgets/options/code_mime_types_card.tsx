import "./code_mime_types_card.css";

import { default as codeNoteMimeTypes } from "@triliumnext/codemirror/src/syntax_highlighting";
import { getCodeLanguageIcon } from "@triliumnext/commons";
import { byMimeType as codeBlockMimeTypes } from "@triliumnext/highlightjs/src/syntax_highlighting";
import clsx from "clsx";
import { useCallback, useMemo } from "preact/hooks";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import mime_types, { orderEnabledMimeTypes, PLAIN_TEXT_MIME } from "../../../services/mime_types";
import options from "../../../services/options";
import ActionButton from "../../react/ActionButton";
import { Badge } from "../../react/Badge";
import FormToggle from "../../react/FormToggle";
import { useTriliumOption, useTriliumOptionBool, useUniqueName } from "../../react/hooks";
import Icon from "../../react/Icon";
import { type SortableItem, SortableCard } from "../../react/SortableCard";

interface CodeMimeTypesCardProps {
    /** Left out in a dialog whose title already names the card. */
    heading?: string;
}

/**
 * The code languages offered by the language lists, in the order the lists show them.
 *
 * In its own module because the always-loaded note type switcher also renders it, while
 * `code_notes.tsx` loads all of CodeMirror. Only the syntax highlighting tables are imported here.
 */
export function CodeMimeTypesCard({ heading }: CodeMimeTypesCardProps) {
    const [ storedOrder, setStoredOrder ] = useTriliumOption("codeNotesMimeTypes");
    const [ isSortedAlphabetically, setIsSortedAlphabetically ] =
        useTriliumOptionBool("codeNotesMimeTypesSortAlphabetically");
    const toggleId = useUniqueName("sort-alphabetically");

    const { mimeTypes, shown, manualOrder } = useMemo(() => {
        mime_types.loadMimeTypes();
        const mimeTypes = mime_types.getMimeTypes();
        const stored = options.getJson("codeNotesMimeTypes");
        return {
            mimeTypes,
            shown: orderEnabledMimeTypes(mimeTypes, stored, isSortedAlphabetically),
            manualOrder: orderEnabledMimeTypes(mimeTypes, stored, false)
                .map((mimeType) => mimeType.mime)
        };
    }, [ storedOrder, isSortedAlphabetically ]); // eslint-disable-line react-hooks/exhaustive-deps

    const items = useMemo(() => shown.map((mimeType) => ({
        key: mimeType.mime,
        caption: mimeType.title,
        icon: getCodeLanguageIcon(mimeType)
    })), [ shown ]);
    const availableCount = mimeTypes.filter((mimeType) => !mimeType.enabled).length;

    const save = useCallback(
        (mimes: string[]) => setStoredOrder(JSON.stringify(mimes)), [ setStoredOrder ]);

    // A sorted card reports additions only: they go at the end of the manual order.
    const store = useCallback((order: SortableItem[]) => {
        const mimes = order.map((item) => item.key);
        if (isSortedAlphabetically) {
            save([ ...manualOrder, ...mimes.filter((mime) => !manualOrder.includes(mime)) ]);
        } else {
            save(mimes);
        }
    }, [ isSortedAlphabetically, manualOrder, save ]);

    const remove = useCallback((mime: string) => {
        save(manualOrder.filter((candidate) => candidate !== mime));
    }, [ manualOrder, save ]);

    /** Opens the item picker on the languages that are not enabled yet. */
    const pick = useCallback(async () => {
        const picked = await dialog.pickSingleItem({
            title: t("code_mime_types.add_title"),
            items: mimeTypes
                .filter((mimeType) => !mimeType.enabled)
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((mimeType) => ({
                    key: mimeType.mime,
                    caption: mimeType.title,
                    icon: getCodeLanguageIcon(mimeType),
                    tooltip: highlightingTooltip(mimeType.mime)
                }))
        });

        return picked
            ? { key: picked.key, caption: picked.caption, icon: picked.icon }
            : undefined;
    }, [ mimeTypes ]);

    return (
        <SortableCard
            className="code-mime-types-card"
            heading={heading}
            description={<>
                <span>{t("code_mime_types.description")}</span>
                <span className="code-mime-types-sort">
                    <label for={toggleId}>{t("code_mime_types.sort_alphabetically")}</label>
                    <FormToggle
                        id={toggleId}
                        currentValue={isSortedAlphabetically}
                        onChange={setIsSortedAlphabetically}
                    />
                </span>
            </>}
            items={items}
            onChange={store}
            isReorderable={!isSortedAlphabetically}
            // The grip leads, leaving the trailing edge to the badges and the remove button.
            gripPlacement="start"
            onItemKeyDown={(item, event) => {
                if (event.key === "Delete" && item.key !== PLAIN_TEXT_MIME) {
                    event.preventDefault();
                    remove(item.key);
                }
            }}
            renderItem={(item) => {
                const isPlainText = item.key === PLAIN_TEXT_MIME;
                return <>
                    {item.icon && (
                        <Icon
                            className={clsx({ "code-mime-types-muted": isPlainText })}
                            icon={item.icon}
                        />
                    )}
                    <span
                        className={clsx("code-mime-types-title",
                            { "code-mime-types-muted": isPlainText })}
                    >
                        {item.caption}
                    </span>
                    <HighlightingBadges mime={item.key} />

                    {!isPlainText && (
                        <ActionButton
                            className="code-mime-types-remove"
                            icon="bx bx-x"
                            text={t("code_mime_types.remove")}
                            onClick={(event) => {
                                event.stopPropagation();
                                remove(item.key);
                            }}
                        />
                    )}
                </>;
            }}
            itemCreationButtons={[ {
                label: t("code_mime_types.add_another", { count: availableCount }),
                icon: "bx bx-plus",
                disabled: !availableCount,
                onCreateItem: pick
            } ]}
        />
    );
}

/** Where a language is syntax highlighted. Plain text is highlighted nowhere. */
function HighlightingBadges({ mime }: { mime: string }) {
    if (mime === PLAIN_TEXT_MIME) {
        return null;
    }

    return (
        <>
            {!!codeBlockMimeTypes[mime] && (
                <Badge
                    className="code-mime-types-badge"
                    text={t("code_mime_types.badge_code_blocks")}
                    tooltip={t("code_mime_types.badge_code_blocks_tooltip")}
                    outline
                />
            )}
            {!!codeNoteMimeTypes[mime] && (
                <Badge
                    className="code-mime-types-badge"
                    text={t("code_mime_types.badge_code_notes")}
                    tooltip={t("code_mime_types.badge_code_notes_tooltip")}
                    outline
                />
            )}
        </>
    );
}

/** The picker's tooltip for a language: whether each highlighter supports it. */
function highlightingTooltip(mime: string) {
    const mark = (isSupported: boolean) => (isSupported ? "✅" : "❌");
    return [
        `<strong>${t("code_mime_types.tooltip_syntax_highlighting")}</strong>`,
        `${mark(!!codeBlockMimeTypes[mime])} ${t("code_mime_types.tooltip_code_block_syntax")}`,
        `${mark(!!codeNoteMimeTypes[mime])} ${t("code_mime_types.tooltip_code_note_syntax")}`
    ].join("\n");
}
