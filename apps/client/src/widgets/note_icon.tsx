import "./note_icon.css";

import { IconRegistry } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import clsx from "clsx";
import { t } from "i18next";
import { CSSProperties, RefObject } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CellComponentProps, Grid } from "react-window";

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

let iconToCountCache!: Promise<IconToCountCache> | null;

type IconWithName = (IconRegistry["sources"][number]["icons"][number] & { iconPack: string });

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
    const [ filterByPrefix, setFilterByPrefix ] = useState<string | null>(null);
    useStaticTooltip(iconListRef, {
        selector: "span",
        customClass: "pre-wrap-text",
        animation: false,
        title() { return this.getAttribute("title") || ""; },
    });

    const allIcons = useAllIcons();
    const filteredIcons = useFilteredIcons(allIcons, search, filterByPrefix);

    return (
        <>
            <div class="filter-row">
                <span>{t("note_icon.search")}</span>
                <FormTextBox
                    inputRef={searchBoxRef}
                    type="text"
                    name="icon-search"
                    placeholder={ filterByPrefix
                        ? t("note_icon.search_placeholder_filtered", {
                            number: filteredIcons.length ?? 0,
                            name: glob.iconRegistry.sources.find(s => s.prefix === filterByPrefix)?.name ?? ""
                        })
                        : t("note_icon.search_placeholder", { number: filteredIcons.length ?? 0, count: glob.iconRegistry.sources.length })}
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
                    if (!clickedTarget.classList.contains("tn-icon")) return;

                    const iconClass = Array.from(clickedTarget.classList.values()).filter(c => c !== "tn-icon").join(" ");
                    if (note) {
                        const attributeToSet = note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass";
                        attributes.setLabel(note.noteId, attributeToSet, iconClass);
                    }
                    dropdownRef?.current?.hide();
                }}
            >
                {filteredIcons.length ? (
                    <Grid
                        columnCount={12}
                        columnWidth={48}
                        rowCount={Math.ceil(filteredIcons.length / 12)}
                        rowHeight={48}
                        cellComponent={IconItemCell}
                        cellProps={{
                            filteredIcons
                        }}
                    />
                ) : (
                    <div class="no-results">{t("note_icon.no_results")}</div>
                )}
            </div>
        </>
    );
}

function IconItemCell({ rowIndex, columnIndex, style, filteredIcons }: CellComponentProps<{
    filteredIcons: IconWithName[];
}>): React.JSX.Element {
    const iconIndex = rowIndex * 12 + columnIndex;
    const iconData = filteredIcons[iconIndex] as IconWithName | undefined;
    if (!iconData) return <></>;

    const { id, terms, iconPack } = iconData;
    return (
        <span
            key={id}
            class={clsx(id, "tn-icon")}
            title={t("note_icon.icon_tooltip", { name: terms?.[0] ?? id, iconPack })}
            style={style as CSSProperties}
        />
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

function useAllIcons() {
    const [ allIcons, setAllIcons ] = useState<IconWithName[]>();

    useEffect(() => {
        getIconToCountMap().then((iconsToCount) => {
            const allIcons = [
                ...glob.iconRegistry.sources.flatMap(s => s.icons.map((i) => ({
                    ...i,
                    iconPack: s.name,
                })))
            ];

            // Sort by count.
            if (iconsToCount) {
                allIcons.sort((a, b) => {
                    const countA = iconsToCount[a.id ?? ""] || 0;
                    const countB = iconsToCount[b.id ?? ""] || 0;

                    return countB - countA;
                });
            }

            setAllIcons(allIcons);
        });
    }, []);

    return allIcons;
}

function useFilteredIcons(allIcons: IconWithName[] | undefined, search: string | undefined, filterByPrefix: string | null) {
    // Filter by text and/or icon pack.
    const filteredIcons = useMemo(() => {
        let icons: IconWithName[] = allIcons ?? [];
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
        return icons;
    }, [ allIcons, search, filterByPrefix ]);
    return filteredIcons;
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
