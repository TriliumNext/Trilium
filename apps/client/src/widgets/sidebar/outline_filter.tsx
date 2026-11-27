import { createContext } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useContext, useLayoutEffect, useMemo, useRef } from "preact/hooks";

import {
    filterOutline, type OutlineFilterResult, prepareFilterText, useFilterState
} from "../react/filter";
import Icon from "../react/Icon";
import { getHtmlMatchText } from "../react/RawHtml";

/** What a section of a filterable tab reports about the filter in force. */
export type OutlineReport =
    /** `navigates`: whether the section, once ready, can answer Enter. */
    | { status: "loading"; navigates: boolean }
    | { status: "failed" }
    | { status: "ready"; count: number; activateFirst?: () => void };

/** What Enter does for an order of cards: run an action, wait for a section, or nothing. */
export type OutlineWalkResult = { action: () => void } | "wait" | null;

/** How a card of a filterable tab is laid out. */
export interface OutlineCardState {
    /** Whether the user collapsed the card: its section is out of the filter. */
    isCollapsed: boolean;
    /** Whether the card shows "No matches" in its body, as one opened during a filter can. */
    showsNoMatches: boolean;
}

/**
 * The reports of the sections of a filterable tab, and the cards they are shown in. Each section
 * reports through one reporter or more, such as a provider that waits and the list it hands over
 * to; the section's state combines them.
 */
export class OutlineResults {
    private reports = new Map<string, Map<object, OutlineReport>>();
    private sections = new Map<string, OutlineReport>();
    private cards = new Map<string, OutlineCardState>();
    private listeners = new Set<() => void>();
    private version = 0;

    report(section: string, reporter: object, report: OutlineReport) {
        const reports = this.reports.get(section) ?? new Map<object, OutlineReport>();
        this.reports.set(section, reports);
        reports.set(reporter, report);
        this.updateSection(section);
    }

    removeReport(section: string, reporter: object) {
        const reports = this.reports.get(section);
        if (!reports?.delete(reporter)) return;
        if (reports.size === 0) {
            this.reports.delete(section);
        }
        this.updateSection(section);
    }

    registerCard(section: string, state: OutlineCardState) {
        const previous = this.cards.get(section);
        if (previous?.isCollapsed === state.isCollapsed
            && previous.showsNoMatches === state.showsNoMatches) return;
        this.cards.set(section, state);
        this.notify();
    }

    unregisterCard(section: string) {
        if (this.cards.delete(section)) {
            this.notify();
        }
    }

    /** The combined report of `section`, the same object for as long as it does not change. */
    getSection(section: string): OutlineReport | undefined {
        return this.sections.get(section);
    }

    /**
     * Whether nothing matches: at least one open card's section has reported, each of those has
     * no result, and no card shows its own "No matches".
     */
    isEmpty() {
        let hasReport = false;
        for (const [ section, card ] of this.cards) {
            if (card.isCollapsed) continue;
            if (card.showsNoMatches) return false;
            const report = this.sections.get(section);
            if (!report) continue;
            if (report.status !== "ready" || report.count > 0) return false;
            hasReport = true;
        }
        return hasReport;
    }

    /**
     * What Enter does, reading the sections of the open cards in `order`: the first result that
     * can be run, or a wait at a section still loading before it that can answer.
     */
    walk(order: string[]): OutlineWalkResult {
        for (const section of order) {
            const card = this.cards.get(section);
            const report = this.sections.get(section);
            if (!card || card.isCollapsed || !report) continue;
            if (report.status === "loading" && report.navigates) return "wait";
            if (report.status === "ready" && report.count > 0 && report.activateFirst) {
                return { action: report.activateFirst };
            }
        }
        return null;
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** A number that changes with every notification, as a snapshot of the whole store. */
    getVersion = () => this.version;

    private updateSection(section: string) {
        const combined = combineReports([ ...this.reports.get(section)?.values() ?? [] ]);
        const previous = this.sections.get(section);
        if (isSameReport(previous, combined)) return;
        if (combined) {
            this.sections.set(section, combined);
        } else {
            this.sections.delete(section);
        }
        this.notify();
    }

    private notify() {
        this.version++;
        for (const listener of [ ...this.listeners ]) {
            listener();
        }
    }
}

/** The store of the filterable tab around a section, `null` elsewhere. */
export const OutlineResultsContext = createContext<OutlineResults | null>(null);

/**
 * Reports `report` for `section` while mounted, from a layout effect. `null` withdraws it.
 * Outside a filterable tab it does nothing.
 */
export function useOutlineReport(section: string, report: OutlineReport | null) {
    const store = useContext(OutlineResultsContext);
    const reporter = useRef({}).current;

    useLayoutEffect(() => {
        if (!store) return;
        if (report) {
            store.report(section, reporter, report);
        } else {
            store.removeReport(section, reporter);
        }
    });

    useLayoutEffect(() => {
        if (!store) return;
        return () => store.removeReport(section, reporter);
    }, [ store, section, reporter ]);
}

/** What `section` reported, `undefined` before it does or outside a filterable tab. */
export function useOutlineSection(section: string) {
    const store = useContext(OutlineResultsContext);
    return useSyncExternalStore(
        store?.subscribe ?? subscribeToNothing,
        () => store?.getSection(section)
    );
}

/** Registers the card of `section` with the store of its tab, while mounted. */
export function useOutlineCard(section: string, { isCollapsed, showsNoMatches }: OutlineCardState) {
    const store = useContext(OutlineResultsContext);

    useLayoutEffect(() => {
        store?.registerCard(section, { isCollapsed, showsNoMatches });
    }, [ store, section, isCollapsed, showsNoMatches ]);

    useLayoutEffect(() => {
        if (!store) return;
        return () => store.unregisterCard(section);
    }, [ store, section ]);
}

export interface OutlineFilterOptions<T> {
    /** The `id` of the section's card. */
    section: string;
    /** The text the row shows, as plain text. */
    getText?(item: T): string;
    /** The text the row shows, as markup. Matched on the text that `HighlightedHtml` paints. */
    getHtml?(item: T): string;
    /** The level of an item, which nests it under the items before it. */
    getLevel?(item: T): number | undefined;
    /** The group of an item: an item nests only under items of its group. */
    getGroup?(item: T): unknown;
    /** The row's action, which its click runs too. Without it, Enter passes the section over. */
    activate?(item: T): void;
    /** Whether Enter can run `activate` for the item. */
    canActivate?(item: T): boolean;
    /** Reported as `loading`: the items are not read yet, or not usable yet. */
    isLoading?: boolean;
}

/** A row of a filtered section: an item that matches, with its place in the outline. */
export interface OutlineMatch<T> extends OutlineFilterResult<T> {
    /** The text of each of `parents`, the outermost first. */
    parentTexts: string[];
}

/**
 * Filters the items of an outline section by the filter of its tab, and reports the result.
 *
 * The section contract: define one `activate(item)` that the row's click calls too, and that
 * calls `NavigatedInNote` after it shows a place in the note. Pass `null` items, or `isLoading`,
 * until the items can be used. On `null` from this hook, render as without a filter; otherwise
 * render only the matches, as one flat list, each row with its `parentTexts` joined by " / " and
 * its matched words painted. A section that does not call this hook has its card hidden while
 * filtering.
 *
 * @returns `null` while nothing is filtered, else the matching items in their order.
 */
export function useOutlineFilter<T>(
    items: readonly T[] | null, options: OutlineFilterOptions<T>
): OutlineMatch<T>[] | null {
    const { section, getLevel, getGroup, activate, canActivate, isLoading } = options;
    const filter = useFilterState();
    const getTexts = usePreparedTexts(options);
    const isReady = !!items && !isLoading;

    const matches = useMemo(() => {
        if (!filter || !items || !isReady) return null;
        const { rawByItem, prepared } = getTexts(items);
        return filterOutline(items, filter.tokens, { texts: prepared, getLevel, getGroup })
            .map((result) => ({
                ...result,
                parentTexts: result.parents.map((parent) => rawByItem.get(parent) ?? "")
            }));
        // The callbacks of `options` are read as they are when the items or the filter change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ filter, items, isReady ]);

    const activateRef = useRef(activate);
    activateRef.current = activate;
    const firstItem = matches?.find(({ item }) => canActivate?.(item) ?? true)?.item;
    const hasActivate = !!activate;
    const activateFirst = useMemo(() => (firstItem !== undefined && hasActivate
        ? () => activateRef.current?.(firstItem)
        : undefined), [ firstItem, hasActivate ]);

    let report: OutlineReport | null = null;
    if (filter) {
        report = matches
            ? { status: "ready", count: matches.length, activateFirst }
            : { status: "loading", navigates: hasActivate };
    }
    useOutlineReport(section, report);

    if (!filter) return null;
    return matches ?? [];
}

/** The body of a card whose section reads its items while its tab filters. */
export function OutlineLoading() {
    return (
        <div className="right-pane-outline-loading">
            <Icon icon="bx bx-loader-alt bx-spin" />
        </div>
    );
}

interface PreparedTexts<T> {
    items: readonly T[];
    /** The text of each item, white space collapsed, for labels. */
    rawByItem: Map<T, string>;
    /** The text of each item prepared by `prepareFilterText()`, in the order of the items. */
    prepared: string[];
}

/**
 * Reads the texts of an items array once, when a filter first needs them. For markup, the texts
 * of the previous array are reused by markup, so a new array reads only the changed items.
 */
function usePreparedTexts<T>({ getText, getHtml }: OutlineFilterOptions<T>) {
    const cacheRef = useRef<PreparedTexts<T> | null>(null);
    const htmlTextsRef = useRef(new Map<string, { raw: string; prepared: string }>());

    return (items: readonly T[]): PreparedTexts<T> => {
        if (cacheRef.current?.items === items) return cacheRef.current;

        const previousTexts = htmlTextsRef.current;
        const htmlTexts = new Map<string, { raw: string; prepared: string }>();
        const rawByItem = new Map<T, string>();
        const prepared: string[] = [];
        for (const item of items) {
            let texts: { raw: string; prepared: string };
            if (getHtml) {
                const html = getHtml(item);
                texts = htmlTexts.get(html) ?? previousTexts.get(html)
                    ?? prepareText(getHtmlMatchText(html));
                htmlTexts.set(html, texts);
            } else {
                texts = prepareText(getText?.(item) ?? "");
            }
            rawByItem.set(item, texts.raw);
            prepared.push(texts.prepared);
        }
        htmlTextsRef.current = htmlTexts;
        cacheRef.current = { items, rawByItem, prepared };
        return cacheRef.current;
    };
}

function prepareText(text: string) {
    const raw = text.replace(/\s+/g, " ").trim();
    return { raw, prepared: prepareFilterText(raw) };
}

function combineReports(reports: OutlineReport[]): OutlineReport | undefined {
    if (reports.length === 0) return undefined;

    const loading = reports.filter((report) => report.status === "loading");
    if (loading.length > 0) {
        return { status: "loading", navigates: loading.some((report) => report.navigates) };
    }
    if (reports.some((report) => report.status === "failed")) {
        return { status: "failed" };
    }

    let count = 0;
    let activateFirst: (() => void) | undefined;
    for (const report of reports) {
        if (report.status !== "ready") continue;
        count += report.count;
        activateFirst ??= report.activateFirst;
    }
    return { status: "ready", count, activateFirst };
}

function isSameReport(a: OutlineReport | undefined, b: OutlineReport | undefined) {
    if (!a || !b) return a === b;
    if (a.status === "loading" && b.status === "loading") return a.navigates === b.navigates;
    if (a.status === "ready" && b.status === "ready") {
        return a.count === b.count && a.activateFirst === b.activateFirst;
    }
    return a.status === b.status;
}

function subscribeToNothing() {
    return () => {};
}
