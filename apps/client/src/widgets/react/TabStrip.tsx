import "./TabStrip.css";

import clsx from "clsx";
import { useRef } from "preact/hooks";

import { useStaticTooltip } from "./hooks";

export interface TabStripTabDefinition<T extends string> {
    id: T;
    title: string;
    /** A full icon class, e.g. `bx bx-list-ul`. */
    icon: string;
}

interface TabStripProps<T extends string> {
    tabs: TabStripTabDefinition<T>[];
    activeTabId?: T;
    onSelect: (tabId: T) => void;
    /** The host's own class, for the geometry of the row the strip heads. */
    className?: string;
    /** Name each tab in text across the full width instead of an icon, for touch screens with no tooltips. */
    labelled?: boolean;
    /** With `labelled`, show the icon above the name, as a bottom tab bar does. */
    withIcons?: boolean;
}

/**
 * A row of tabs shown as icons alone, each named by a tooltip: the header of a panel divided into
 * groups of widgets or fields.
 *
 * Drawn as a button group, which is how Trilium draws a choice between several things: a recessed
 * track with the one on show raised out of it. The theme dresses the class; all the strip does is
 * size it to a header row, and leave the row itself to whoever it heads (see {@link className}).
 */
export default function TabStrip<T extends string>({ tabs, activeTabId, onSelect, className, labelled, withIcons }: TabStripProps<T>) {
    return (
        // Centred in the row rather than run up against its start (see TabStrip.css).
        <div class={clsx("tab-strip", labelled && "tab-strip-labelled", labelled && withIcons && "tab-strip-with-icons", className)}>
            <div class="btn-group tab-strip-group" role="tablist">
                {tabs.map((tab) => (
                    <TabStripTab
                        key={tab.id}
                        tab={tab}
                        active={tab.id === activeTabId}
                        labelled={labelled}
                        withIcons={withIcons}
                        onSelect={() => onSelect(tab.id)}
                    />
                ))}
            </div>
        </div>
    );
}

function TabStripTab<T extends string>({ tab, active, labelled, withIcons, onSelect }: { tab: TabStripTabDefinition<T>; active: boolean; labelled?: boolean; withIcons?: boolean; onSelect: () => void }) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Unless `labelled`, no tab is named in the strip, the selected one included: every tab is the
    // same icon-sized segment, which keeps a whole group inside a panel narrow enough to only fit the
    // icons. The name is the tooltip, and it is the only place it appears.
    useStaticTooltip(buttonRef, labelled ? undefined : {
        title: tab.title,
        placement: "bottom",
        fallbackPlacements: [ "bottom" ],
        animation: false
    });

    return (
        <button
            ref={buttonRef}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={labelled ? undefined : tab.title}
            // `icon-action` is what the button group sizes and fills its segments by; `active` is what
            // it raises the one on show with.
            class={clsx("tab-strip-tab icon-action", active && "active")}
            onClick={onSelect}
        >
            {(!labelled || withIcons) && <span class={clsx("tab-strip-tab-icon tn-icon", tab.icon)} />}
            {labelled && <span class="tab-strip-tab-label">{tab.title}</span>}
        </button>
    );
}
