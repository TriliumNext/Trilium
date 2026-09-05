import "./IconPicker.css";

import { IconRegistry } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import clsx from "clsx";
import { CSSProperties } from "preact";
import { createPortal } from "preact/compat";
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
import { useStaticTooltip, useWindowSize } from "./hooks";
import Modal from "./Modal";

/** The room one icon takes in the grid, which also decides how many fit across a given width. */
export const ICON_SIZE = isMobile() ? 56 : 48;

// One tooltip on the grid, delegated to the icon tiles. A module constant so the grid re-rendering
// on every keystroke in the search does not tear the tooltip down and build it again each time.
const ICON_TOOLTIP_CONFIG: Partial<Tooltip.Options> = {
    selector: "span",
    customClass: "pre-wrap-text",
    animation: false,
    title() { return this.getAttribute("title") || ""; },
};

interface IconPickerProps {
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
}

/**
 * The picker an icon is chosen through: every icon of every installed pack, searchable by name and
 * narrowable to one pack, the ones already used across the note tree leading.
 *
 * It only reports what was picked — what that means is the host's own business, whether it is the
 * icon of a note or of something else entirely.
 */
export default function IconPicker({ onSelect, onReset, resetText, columnCount }: IconPickerProps) {
    const iconListRef = useRef<HTMLDivElement>(null);
    const [ search, setSearch ] = useState<string>();
    const [ filterByPrefix, setFilterByPrefix ] = useState<string | null>(null);
    useStaticTooltip(iconListRef, ICON_TOOLTIP_CONFIG);

    const allIcons = useAllIcons();
    const filteredIcons = useFilteredIcons(allIcons, search, filterByPrefix);

    return (
        // The legacy class is kept alongside the picker's own: the themes dress the icon grid
        // through it, having known the picker only as a part of the note icon widget.
        <div className="icon-picker note-icon-widget">
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
                    width: (columnCount * ICON_SIZE + 10),
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
        </div>
    );
}

interface IconPickerButtonProps extends Pick<IconPickerProps, "onSelect" | "onReset" | "resetText"> {
    /** The class the button wears, which is the icon it stands for, e.g. `bx bx-star`. */
    icon: string;
    /** What pressing it is for, worn as its tooltip and as the heading of the modal on a phone. */
    title: string;
    /** The host's own class, for a host that dresses the button or the widget around it. */
    className?: string;
    disabled?: boolean;
    /**
     * Said as the picker opens and closes, for a host that has to hold something open while the
     * reader is in it: the picker takes focus with it, and an editor that closes on losing focus
     * would take the picker down with itself.
     */
    onOpened?: () => void;
    onClosed?: () => void;
    /** Dim the page behind the picker, for a host that would rather it were answered before
     * anything else. Has no effect on a phone, where the picker is a dialog with a backdrop of its
     * own. */
    backdrop?: boolean;
}

/**
 * The button an icon is picked through: the picker hangs under it, and what is picked is reported
 * and the picker put away.
 *
 * Where it is put differs with the screen. A desktop gets the menu under the button, at the width
 * twelve icons and a search field ask for. A phone gets a modal of its own instead: that width is
 * wider than the screen, and a menu of it — hung off a button that may itself be in the corner of a
 * panel — leaves the grid mostly off-screen, which is no way to pick from a thousand icons.
 */
export function IconPickerButton({ className, ...props }: IconPickerButtonProps) {
    // A constant of the session rather than of the render, as everywhere else it is branched on.
    return isMobile()
        ? <IconPickerModalButton className={className} {...props} />
        : <IconPickerDropdownButton className={className} {...props} />;
}

/** The picker under the button, as a desktop shows it. */
function IconPickerDropdownButton({
    icon, title, className, disabled, onSelect, onReset, resetText, onOpened, onClosed, backdrop
}: IconPickerButtonProps) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const [ pickerShown, setPickerShown ] = useState(false);

    return (
        <Dropdown
            // The legacy class dresses the menu the picker sits in, which the themes and the
            // picker's own stylesheet reach through it.
            className={clsx("note-icon-widget", className)}
            buttonClassName={`note-icon tn-focusable-button ${icon}`}
            title={title}
            disabled={disabled}
            dropdownRef={dropdownRef}
            dropdownContainerStyle={{ width: "620px" }}
            dropdownOptions={{
                autoClose: "outside",
                // Popper guards only the main axis against overflow, so a menu this tall, hung off
                // a button with room for it neither above nor below, was left hanging off the
                // bottom of the screen. Guarding the other axis too slides it back into view; the
                // side it opens on is still `flip`'s to choose.
                popperConfig: (defaults) => ({
                    ...defaults,
                    modifiers: [
                        ...(defaults.modifiers ?? []),
                        { name: "preventOverflow", options: { altAxis: true, padding: 8 } }
                    ]
                })
            }}
            // The menu is wider than some of the places a button stands in, and the inline title
            // establishes a backdrop root that would flatten its blur into a tint; hand the menu to
            // the page rather than leaving it to be clipped or dulled.
            portalToBody
            backdrop={backdrop}
            hideToggleArrow
            onShown={() => {
                setPickerShown(true);
                onOpened?.();
            }}
            onHidden={() => {
                setPickerShown(false);
                onClosed?.();
            }}
        >
            {/* Built only once opened: it holds every icon of every installed pack, which is far
                more work than a button that merely happens to be on screen should be doing. */}
            {pickerShown && (
                <IconPicker
                    columnCount={12}
                    resetText={resetText}
                    onSelect={(iconClass) => {
                        onSelect(iconClass);
                        dropdownRef.current?.hide();
                    }}
                    onReset={onReset && (() => {
                        onReset();
                        dropdownRef.current?.hide();
                    })}
                />
            )}
        </Dropdown>
    );
}

/** The picker on a screen of its own, as a phone shows it. */
function IconPickerModalButton({
    icon, title, className, disabled, onSelect, onReset, resetText, onOpened, onClosed
}: IconPickerButtonProps) {
    const [ modalShown, setModalShown ] = useState(false);
    const { windowWidth } = useWindowSize();

    return (
        <div className={clsx("note-icon-widget", className)}>
            <ActionButton
                className="note-icon"
                icon={icon}
                text={title}
                // The dropdown button a desktop shows is a `btn`, which the note icon's own rules
                // size. `icon-action` instead is sized by the theme as a toolbar button, which is
                // larger, so the same icon would be drawn differently on the two.
                noIconActionClass
                onClick={() => {
                    setModalShown(true);
                    onOpened?.();
                }}
                disabled={disabled}
            />

            {/* Out of whatever the button stands in — a panel floating over a note holds its own
                stacking context, and the modal belongs to the page rather than to it. */}
            {createPortal((
                <Modal
                    title={title}
                    size="xl"
                    show={modalShown}
                    onHidden={() => {
                        setModalShown(false);
                        onClosed?.();
                    }}
                    className="icon-switcher note-icon-widget"
                    scrollable
                    stackable
                >
                    {/* As many icons as the screen has room for, rather than the twelve a menu is
                        built for (see the CSS, which gives the grid the rest of the screen). */}
                    <IconPicker
                        columnCount={Math.max(1, Math.floor(windowWidth / ICON_SIZE))}
                        resetText={resetText}
                        onSelect={(iconClass) => {
                            onSelect(iconClass);
                            setModalShown(false);
                        }}
                        onReset={onReset && (() => {
                            onReset();
                            setModalShown(false);
                        })}
                    />
                </Modal>
            ), document.body)}
        </div>
    );
}

type IconWithName = (IconRegistry["sources"][number]["icons"][number] & { iconPack: string });

interface IconToCountCache {
    iconClassToCountMap: Record<string, number>;
}

let iconToCountCache!: Promise<IconToCountCache> | null;

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
                        name: glob.iconRegistry.sources.find(s => s.prefix === filterByPrefix)?.name ?? ""
                    })
                    : t("note_icon.search_placeholder", { number: filteredIcons.length ?? 0, count: glob.iconRegistry.sources.length })}
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
