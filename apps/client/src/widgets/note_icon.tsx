import "./note_icon.css";

import { IconRegistry } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import clsx from "clsx";
import { t } from "i18next";
import { CSSProperties } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type React from "react";
import { CellComponentProps, Grid } from "react-window";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import server from "../services/server";
import { isDesktop, isMobile } from "../services/utils";
import ActionButton from "./react/ActionButton";
import Dropdown from "./react/Dropdown";
import { FormDropdownDivider, FormListItem } from "./react/FormList";
import FormTextBox from "./react/FormTextBox";
import { useNoteContext, useNoteLabel, useStaticTooltip, useWindowSize } from "./react/hooks";
import Modal from "./react/Modal";

const ICON_SIZE = isMobile() ? 56 : 48;

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

    if (isMobile()) {
        return <MobileNoteIconSwitcher note={note} icon={icon} />;
    }

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
            { note && <NoteIconList note={note} onHide={() => dropdownRef?.current?.hide()} columnCount={12} /> }
        </Dropdown>
    );
}

function MobileNoteIconSwitcher({ note, icon }: {
    note: FNote | null | undefined;
    icon: string | null | undefined;
}) {
    const [ modalShown, setModalShown ] = useState(false);
    const { windowWidth } = useWindowSize();

    return (
        <div className="note-icon-widget">
            <ActionButton
                className="note-icon"
                icon={icon ?? "bx bx-empty"}
                text={t("note_icon.change_note_icon")}
                onClick={() => setModalShown(true)}
            />

            {createPortal((
                <Modal
                    title={t("note_icon.change_note_icon")}
                    size="xl"
                    show={modalShown} onHidden={() => setModalShown(false)}
                    className="icon-switcher note-icon-widget"
                    scrollable
                >
                    {note && <NoteIconList note={note} onHide={() => setModalShown(false)} columnCount={Math.max(1, Math.floor(windowWidth / ICON_SIZE))} />}
                </Modal>
            ), document.body)}
        </div>
    );
}

function NoteIconList({ note, onHide, columnCount }: {
    note: FNote;
    onHide: () => void;
    columnCount: number;
}) {
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
            <FilterRow
                note={note}
                filterByPrefix={filterByPrefix}
                search={search}
                setSearch={setSearch}
                setFilterByPrefix={setFilterByPrefix}
                filteredIcons={filteredIcons}
                onHide={onHide}
            />

            <div
                class="icon-list"
                ref={iconListRef}
                style={{
                    width: (columnCount * ICON_SIZE + 10),
                }}
                onClick={(e) => {
                    // Make sure we are not clicking on something else than a button.
                    const clickedTarget = e.target as HTMLElement;
                    if (!clickedTarget.classList.contains("tn-icon")) return;

                    const iconClass = Array.from(clickedTarget.classList.values()).filter(c => c !== "tn-icon").join(" ");
                    if (note) {
                        const attributeToSet = note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass";
                        attributes.setLabel(note.noteId, attributeToSet, iconClass);
                    }
                    onHide();
                }}
            >
                {filteredIcons.length ? (
                    <Grid
                        columnCount={columnCount}
                        columnWidth={ICON_SIZE}
                        rowCount={Math.ceil(filteredIcons.length / columnCount)}
                        rowHeight={ICON_SIZE}
                        cellComponent={IconItemCell}
                        cellProps={{
                            filteredIcons,
                            columnCount
                        }}
                    />
                ) : (
                    <div class="no-results">{t("note_icon.no_results")}</div>
                )}
            </div>
        </>
    );
}

function FilterRow({ note, filterByPrefix, search, setSearch, setFilterByPrefix, filteredIcons, onHide }: {
    note: FNote;
    filterByPrefix: string | null;
    search: string | undefined;
    setSearch: (value: string | undefined) => void;
    setFilterByPrefix: (value: string | null) => void;
    filteredIcons: IconWithName[];
    onHide: () => void;
}) {
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const hasCustomIcon = getIconLabels(note).length > 0;

    function resetToDefaultIcon() {
        if (!note) return;
        for (const label of getIconLabels(note)) {
            attributes.removeAttributeById(note.noteId, label.attributeId);
        }
        onHide();
    }

    return (
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

            {isDesktop()
                ? <>
                    {hasCustomIcon && (
                        <div style={{ textAlign: "center" }}>
                            <ActionButton
                                icon="bx bx-reset"
                                text={t("note_icon.reset-default")}
                                onClick={resetToDefaultIcon}
                            />
                        </div>
                    )}

                    {<Dropdown
                        buttonClassName="bx bx-filter-alt"
                        hideToggleArrow
                        noSelectButtonStyle
                        noDropdownListStyle
                        iconAction
                        title={t("note_icon.filter")}
                    >
                        <IconFilterContent filterByPrefix={filterByPrefix} setFilterByPrefix={setFilterByPrefix} />
                    </Dropdown>}
                </> : (
                    <Dropdown
                        buttonClassName="bx bx-dots-vertical-rounded"
                        hideToggleArrow
                        noSelectButtonStyle
                        noDropdownListStyle
                        iconAction
                        dropdownContainerClassName="mobile-bottom-menu"
                    >
                        {hasCustomIcon && <>
                            <FormListItem
                                icon="bx bx-reset"
                                onClick={resetToDefaultIcon}
                                disabled={!hasCustomIcon}
                            >{t("note_icon.reset-default")}</FormListItem>
                            <FormDropdownDivider />
                        </>}

                        <IconFilterContent filterByPrefix={filterByPrefix} setFilterByPrefix={setFilterByPrefix} />
                    </Dropdown>
                )}
        </div>
    );
}

function IconItemCell({ rowIndex, columnIndex, style, filteredIcons, columnCount }: CellComponentProps<{
    filteredIcons: IconWithName[];
    columnCount: number;
}>) {
    const iconIndex = rowIndex * columnCount + columnIndex;
    const iconData = filteredIcons[iconIndex] as IconWithName | undefined;
    if (!iconData) return <></> as React.ReactElement;

    const { id, terms, iconPack } = iconData;
    return (
        <span
            key={id}
            class={clsx(id, "tn-icon")}
            title={t("note_icon.icon_tooltip", { name: terms?.[0] ?? id, iconPack })}
            style={style as CSSProperties}
        />
    ) as React.ReactElement;
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
            {glob.iconRegistry.sources.length > 1 && <FormDropdownDivider />}

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
