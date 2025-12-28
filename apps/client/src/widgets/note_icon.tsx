import "./note_icon.css";

import { IconRegistry } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import { t } from "i18next";
import { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import server from "../services/server";
import ActionButton from "./react/ActionButton";
import Dropdown from "./react/Dropdown";
import { FormDropdownDivider, FormListItem } from "./react/FormList";
import FormTextBox from "./react/FormTextBox";
import { useNoteContext, useNoteLabel, useStaticTooltip } from "./react/hooks";

interface IconToCountCache {
    iconClassToCountMap: Record<string, number>;
}

interface IconData {
    iconToCount: Record<string, number>;
    icons: (IconRegistry["sources"][number]["icons"][number] & { iconPack: string })[];
}

let iconToCountCache!: Promise<IconToCountCache> | null;

export default function NoteIcon() {
    const { note, viewScope } = useNoteContext();
    const [ icon, setIcon ] = useState<string | null | undefined>();
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");
    const dropdownRef = useRef<BootstrapDropdown>(null);

    useEffect(() => {
        setIcon(note?.getIcon());
    }, [ note, iconClass, workspaceIconClass ]);

    return (
        <Dropdown
            className="note-icon-widget"
            title={t("note_icon.change_note_icon")}
            dropdownRef={dropdownRef}
            dropdownContainerStyle={{ width: "620px" }}
            dropdownOptions={{ autoClose: "outside" }}
            buttonClassName={`note-icon tn-focusable-button ${icon ?? "bx bx-empty"}`}
            hideToggleArrow
            disabled={viewScope?.viewMode !== "default"}
        >
            { note && <NoteIconList note={note} dropdownRef={dropdownRef} /> }
        </Dropdown>
    );
}

function NoteIconList({ note, dropdownRef }: {
    note: FNote,
    dropdownRef: RefObject<BootstrapDropdown>;
}) {
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const iconListRef = useRef<HTMLDivElement>(null);
    const [ search, setSearch ] = useState<string>();
    const [ iconData, setIconData ] = useState<IconData>();
    const [ filterByPrefix, setFilterByPrefix ] = useState<string | null>(null);
    useStaticTooltip(iconListRef, {
        selector: "span",
        customClass: "pre-wrap-text",
        animation: false,
        title() { return this.getAttribute("title") || ""; },
    });

    useEffect(() => {
        async function loadIcons() {
            // Filter by text and/or category.
            let icons: IconData["icons"] = [
                ...glob.iconRegistry.sources.map(s => s.icons.map((i) => ({
                    ...i,
                    iconPack: s.name,
                }))).flat()
            ];
            const processedSearch = search?.trim()?.toLowerCase();
            if (processedSearch || filterByPrefix !== null) {
                icons = icons.filter((icon) => {
                    if (filterByPrefix) {
                        if (!icon.id?.startsWith(`${filterByPrefix} `)) {
                            return false;
                        }
                    }

                    if (processedSearch) {
                        if (!icon.terms?.some((t) => t.includes(processedSearch))) {
                            return false;
                        }
                    }

                    return true;
                });
            }

            // Sort by count.
            const iconToCount = await getIconToCountMap();
            if (iconToCount) {
                icons.sort((a, b) => {
                    const countA = iconToCount[a.id ?? ""] || 0;
                    const countB = iconToCount[b.id ?? ""] || 0;

                    return countB - countA;
                });
            }

            setIconData({
                iconToCount,
                icons
            });
        }

        loadIcons();
    }, [ search, filterByPrefix ]);

    return (
        <>
            <div class="filter-row">
                <span>{t("note_icon.search")}</span>
                <FormTextBox
                    inputRef={searchBoxRef}
                    type="text"
                    name="icon-search"
                    placeholder={t("note_icon.search_placeholder")}
                    currentValue={search} onChange={setSearch}
                    autoFocus
                />

                {getIconLabels(note).length > 0 && (
                    <div style={{ textAlign: "center" }}>
                        <ActionButton
                            icon="bx bx-reset"
                            text={t("note_icon.reset-default")}
                            onClick={() => {
                                if (!note) return;
                                for (const label of getIconLabels(note)) {
                                    attributes.removeAttributeById(note.noteId, label.attributeId);
                                }
                                dropdownRef?.current?.hide();
                            }}
                        />
                    </div>
                )}

                {glob.iconRegistry.sources.length > 0 && <Dropdown
                    buttonClassName="bx bx-filter-alt"
                    hideToggleArrow
                    noSelectButtonStyle
                    noDropdownListStyle
                    iconAction
                    title={t("note_icon.filter")}
                >
                    <IconFilterContent filterByPrefix={filterByPrefix} setFilterByPrefix={setFilterByPrefix} />
                </Dropdown>}
            </div>

            <div
                class="icon-list"
                ref={iconListRef}
                onClick={(e) => {
                    // Make sure we are not clicking on something else than a button.
                    const clickedTarget = e.target as HTMLElement;
                    if (clickedTarget.tagName !== "SPAN" || clickedTarget.classList.length !== 2) return;

                    const iconClass = Array.from(clickedTarget.classList.values()).join(" ");
                    if (note) {
                        const attributeToSet = note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass";
                        attributes.setLabel(note.noteId, attributeToSet, iconClass);
                    }
                    dropdownRef?.current?.hide();
                }}
            >
                {iconData?.icons?.length ? (
                    (iconData?.icons ?? []).map(({ id, terms, iconPack }) => (
                        <span
                            key={id}
                            class={id}
                            title={t("note_icon.icon_tooltip", { name: terms?.[0] ?? id, iconPack })}
                        />
                    ))
                ) : (
                    <div class="no-results">{t("note_icon.no_results")}</div>
                )}
            </div>
        </>
    );
}

function IconFilterContent({ filterByPrefix, setFilterByPrefix }: {
    filterByPrefix: string | null;
    setFilterByPrefix: (value: string | null) => void;
}) {
    return (
        <>
            <FormListItem
                checked={filterByPrefix === null}
                onClick={() => setFilterByPrefix(null)}
            >{t("note_icon.filter-none")}</FormListItem>
            <FormListItem
                checked={filterByPrefix === "bx"}
                onClick={() => setFilterByPrefix("bx")}
            >{t("note_icon.filter-default")}</FormListItem>
            <FormDropdownDivider />

            {glob.iconRegistry.sources.map(({ prefix, name, icon }) => (
                prefix !== "bx" && <FormListItem
                    key={prefix}
                    onClick={() => setFilterByPrefix(prefix)}
                    icon={icon}
                    checked={filterByPrefix === prefix}
                >{name}</FormListItem>
            ))}
        </>
    );
}

async function getIconToCountMap() {
    if (!iconToCountCache) {
        iconToCountCache = server.get<IconToCountCache>("other/icon-usage");
        setTimeout(() => (iconToCountCache = null), 20000); // invalidate cache after 20 seconds
    }

    return (await iconToCountCache).iconClassToCountMap;
}

function getIconLabels(note: FNote) {
    if (!note) {
        return [];
    }
    return note.getOwnedLabels()
        .filter((label) => ["workspaceIconClass", "iconClass"]
            .includes(label.name));
}
