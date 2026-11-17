import "./IconPicker.css";

import { IconRegistry } from "@triliumnext/commons";
import type { Tooltip } from "bootstrap";
import clsx from "clsx";
import { createPortal, CSSProperties } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type React from "react";
import { CellComponentProps, Grid } from "react-window";

import { t } from "../../services/i18n";
import server from "../../services/server";
import { isDesktop, isMobile } from "../../services/utils";
import ActionButton from "./ActionButton";
import Dropdown from "./Dropdown";
import { FormDropdownDivider, FormListItem } from "./FormList";
import FormTextBox from "./FormTextBox";
import { useWindowSize } from "./hooks/dom";
import { useStaticTooltip } from "./hooks/tooltip";
import Modal from "./Modal";

/** The room one icon takes in the grid, which also decides how many fit across a given width. */
export const ICON_SIZE = isMobile() ? 56 : 48;

/** The size of one icon cell in the compact grid, in pixels. */
const COMPACT_ICON_SIZE = 40;

/**
 * The number of icon rows the compact grid shows. The partial last row shows that the grid
 * scrolls.
 */
const COMPACT_ROWS = 8.25;

// One tooltip on the grid, delegated to the icon tiles. A module constant so the grid re-rendering
// on every keystroke in the search does not tear the tooltip down and build it again each time.
const ICON_TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    selector: "span",
    customClass: "pre-wrap-text",
    animation: false,
    title() { return this.getAttribute("title") || ""; },
};

export interface IconPickerProps {
    /** Receives the class of the icon picked, e.g. `bx bx-star`. */
    onSelect(iconClass: string): void;
    /**
     * Offered as the way back to no icon of one's own. Left out, the picker only picks — there is
     * nothing to go back to.
     */
    onReset?: () => void;
    /** What going back means, in the host's own words. Left out, it resets "to the default icon". */
    resetText?: string;
    /** How many icons stand side by side; the host decides from the room it can give the grid. */
    columnCount: number;
    /** Renders smaller icons and `COMPACT_ROWS` rows, for the text editor's balloon. */
    compact?: boolean;
}

/**
 * The picker an icon is chosen through: every icon of every installed pack, searchable by name and
 * narrowable to one pack, the ones already used across the note tree leading.
 *
 * It only reports what was picked — what that means is the host's own business, whether it is the
 * icon of a note or of something else entirely.
 */
export default function IconPicker({ onSelect, onReset, resetText, columnCount, compact }: IconPickerProps) {
    const iconSize = compact ? COMPACT_ICON_SIZE : ICON_SIZE;
    const iconListRef = useRef<HTMLDivElement>(null);
    const [ search, setSearch ] = useState<string>();
    const [ filterByPrefix, setFilterByPrefix ] = useState<string | null>(null);
    useStaticTooltip(iconListRef, ICON_TOOLTIP_CONFIG);

    const allIcons = useAllIcons();
    const filteredIcons = useFilteredIcons(allIcons, search, filterByPrefix);

    return (
        // The legacy class is kept alongside the picker's own: the themes dress the icon grid
        // through it, having known the picker only as a part of the note icon widget.
        <div className={clsx("icon-picker", "note-icon-widget", compact && "compact")}>
            <FilterRow
                filterByPrefix={filterByPrefix}
                search={search}
                setSearch={setSearch}
                setFilterByPrefix={setFilterByPrefix}
                filteredIcons={filteredIcons}
                onReset={onReset}
                resetText={resetText}
            />

            <div
                class="icon-list"
                ref={iconListRef}
                style={{
                    width: `calc(${columnCount * iconSize + 10}px + var(--icon-list-inset))`,
                    // The CSS sets the height of the regular grid; the compact grid shows
                    // `COMPACT_ROWS` rows.
                    ...(compact && { height: `${COMPACT_ROWS * iconSize}px` })
                }}
                onClick={(e) => {
                    // Make sure we are not clicking on something else than a button.
                    const clickedTarget = e.target as HTMLElement;
                    if (!clickedTarget.classList.contains("tn-icon")) return;

                    onSelect(Array.from(clickedTarget.classList.values()).filter(c => c !== "tn-icon").join(" "));
                }}
            >
                {filteredIcons.length ? (
                    <Grid
                        className="scroll-edge-fade"
                        columnCount={columnCount}
                        columnWidth={iconSize}
                        rowCount={Math.ceil(filteredIcons.length / columnCount)}
                        rowHeight={iconSize}
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
        </div>
    );
}

interface IconPickerModalProps extends Pick<IconPickerProps, "onSelect" | "onReset" | "resetText"> {
    /** The modal title. */
    title: string;
    show: boolean;
    onHidden(): void;
}

/**
 * Shows the picker in a modal, for mobile and for callers with no button to open a dropdown from.
 *
 * Picking an icon does not close the modal; the caller closes it through `show`.
 */
export function IconPickerModal({ title, show, onHidden, onSelect, onReset, resetText }: IconPickerModalProps) {
    const { windowWidth } = useWindowSize();

    // Portal to `document.body` so that a caller inside a stacking context, such as a panel
    // floating over a note, does not trap the modal.
    return createPortal((
        <Modal
            title={title}
            size="xl"
            show={show}
            onHidden={onHidden}
            className="icon-switcher note-icon-widget"
            scrollable
            stackable
        >
            {/* As many icons as the screen has room for, rather than the twelve a menu is built
                for (see the CSS, which gives the grid the rest of the screen). */}
            <IconPicker
                columnCount={Math.max(1, Math.floor(windowWidth / ICON_SIZE))}
                resetText={resetText}
                onSelect={onSelect}
                onReset={onReset}
            />
        </Modal>
    ), document.body);
}

type IconWithName = (IconRegistry["sources"][number]["icons"][number] & { iconPack: string });

interface IconToCountCache {
    iconClassToCountMap: Record<string, number>;
}

let iconToCountCache!: Promise<IconToCountCache> | null;
let iconRegistryCache: Promise<IconRegistry> | undefined;

function FilterRow({ filterByPrefix, search, setSearch, setFilterByPrefix, filteredIcons, onReset, resetText }: {
    filterByPrefix: string | null;
    search: string | undefined;
    setSearch: (value: string | undefined) => void;
    setFilterByPrefix: (value: string | null) => void;
    filteredIcons: IconWithName[];
    onReset?: () => void;
    resetText?: string;
}) {
    const searchBoxRef = useRef<HTMLInputElement>(null);

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
                        name: glob.iconPacks.find(s => s.prefix === filterByPrefix)?.name ?? ""
                    })
                    : t("note_icon.search_placeholder", { number: filteredIcons.length ?? 0, count: glob.iconPacks.length })}
                currentValue={search} onChange={setSearch}
                autoFocus
            />

            {isDesktop()
                ? <>
                    {onReset && (
                        <div style={{ textAlign: "center" }}>
                            <ActionButton
                                icon="bx bx-reset"
                                text={resetText ?? t("note_icon.reset-default")}
                                onClick={onReset}
                            />
                        </div>
                    )}

                    {<Dropdown
                        buttonClassName="bx bx-filter-alt"
                        hideToggleArrow
                        noSelectButtonStyle
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
                        iconAction
                        mobileBottomSheet
                    >
                        {onReset && <>
                            <FormListItem
                                icon="bx bx-reset"
                                onClick={onReset}
                            >{resetText ?? t("note_icon.reset-default")}</FormListItem>
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
            {glob.iconPacks.length > 1 && <FormDropdownDivider />}

            {glob.iconPacks.map(({ prefix, name, icon }) => (
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
        Promise.all([ getIconRegistry(), getIconToCountMap() ]).then(([ iconRegistry, iconsToCount ]) => {
            const allIcons = [
                ...iconRegistry.sources.flatMap(s => s.icons.map((i) => ({
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
                    // The query is lowercased, so the terms must be too: custom icon packs may
                    // spell them with capitals ("Proxmox"), which would otherwise never match.
                    if (!icon.terms?.some((t) => t.toLowerCase().includes(processedSearch))) {
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

/** Every icon of each pack, fetched once per page: `/bootstrap` names only the packs. */
function getIconRegistry() {
    iconRegistryCache ??= server.get<IconRegistry>("other/icon-registry");
    return iconRegistryCache;
}

async function getIconToCountMap() {
    if (!iconToCountCache) {
        iconToCountCache = server.get<IconToCountCache>("other/icon-usage");
        setTimeout(() => (iconToCountCache = null), 20000); // invalidate cache after 20 seconds
    }

    return (await iconToCountCache).iconClassToCountMap;
}
