import { scrollRectIntoView } from "../services/highlight_matches";
import type { FindResult } from "./find";
import type { ScrollRailTarget } from "./scroll_rail_markers";
import { getEmbedFindTarget, revealContentEmbed } from "./type_widgets/text/content_embed_tools";

/** The options of a search of "Search in note". */
export interface FindOptions {
    matchCase: boolean;
    wholeWord: boolean;
}

/** Whether the search or the write that runs is still wanted. A target that waits checks it. */
export type FindCheck = () => boolean;

/** How a match becomes the current one. */
export interface HighlightOptions {
    /** Scrolls to the match at once, ignoring the smooth scrolling of the boxes around it. */
    isInstant?: boolean;
}

/**
 * What "Search in note" searches: a text editor, the rendered content of a note, a code editor or
 * the content of an embed. Its matches are numbered from 0, in document order.
 */
export interface FindTarget {
    /**
     * Searches for `term` and returns the number of matches, none of them the current one. An empty
     * `term` removes the matches. A target that waits before it paints checks `check` first, and
     * paints nothing once it fails.
     */
    find(term: string, options: FindOptions, check?: FindCheck): Promise<number>;
    /** Makes match `index` the current one and scrolls to it. `null` leaves no current match. */
    highlight(index: number | null, options?: HighlightOptions): void;
    /** The first match at or below `top`, a client Y coordinate, or `null` when all are above. */
    getFirstMatchBelow(top: number): number | null;
    /**
     * What each match is, for the scroll rail, in match order. Reads no geometry. With `isStale`,
     * the matches that the content shows now, which no longer follow the numbering.
     */
    getMatchTargets(options: { isStale: boolean }): ScrollRailTarget[];
    /**
     * Takes the matches anew from the content, which can have changed since the search, and
     * returns their number. The indices of the other methods follow the new list.
     */
    countMatches(): number;
    /** Whether `replace()` replaces match `index`, which a match in read-only content is not. */
    canReplace(index: number): boolean;
    /**
     * Replaces match `index` with `text`, and returns the number of matches left. A target that
     * searches again after it checks `check` before it paints.
     */
    replace(index: number, text: string, check?: FindCheck): Promise<number>;
    /** Replaces each match that `canReplace()` allows, and returns the number of matches left. */
    replaceAll(text: string, check?: FindCheck): Promise<number>;
    /**
     * Removes the matches at once. Returns what selects match `index` and focuses the target,
     * for the caller to run later, or `null` when there is no such match.
     */
    close(index: number | null): (() => void) | null;
    /**
     * Calls `callback` when the content changes, as typing in it does, until the returned function
     * is called. A target over content that cannot change leaves it out.
     */
    watchContent?(callback: () => void): () => void;
}

/** Content with embeds, whose matches `MergedFind` places among the matches of the content. */
export interface HostFindTarget extends FindTarget {
    /** The embeds in the content, in document order. */
    getEmbeds(): HTMLElement[];
    /** The number of matches before the content of `embed`. Matches in its caption come after. */
    countMatchesBefore(embed: HTMLElement): number;
    /**
     * Shows `embed` wherever the content hides it, as a collapsed block does, while one of its
     * matches is the current one. `null` hides it again.
     */
    revealEmbed(embed: HTMLElement | null): void;
    /** The match at the selection, where the find starts, or `null`. */
    getSelectedMatch?(): number | null;
}

/**
 * Searches `host` and its embeds as one document. The content of each embed finds its own
 * matches, which come between the matches of `host` around the embed.
 */
export default class MergedFind implements FindTarget {

    private embeds: EmbedSearch[] = [];
    private hostCount = 0;
    private runs: Run[] = [];
    private total = 0;
    private current: Run | null = null;
    private searchId = 0;

    constructor(readonly host: HostFindTarget) {}

    async find(term: string, options: FindOptions, check?: FindCheck) {
        const searchId = ++this.searchId;
        this.highlight(null);
        const embeds = this.host.getEmbeds().flatMap((embed) => {
            const target = getEmbedFindTarget(embed);
            return target ? [ { embed, target, count: 0 } ] : [];
        });
        for (const { target } of this.embeds) {
            if (!embeds.some((embed) => embed.target === target)) {
                target.close(null);
            }
        }
        this.embeds = embeds;

        await Promise.all([
            this.host.find(term, options, check),
            ...embeds.map(({ target }) => target.find(term, options, check))
        ]);
        if (searchId === this.searchId) {
            this.countAll();
        }
        return this.total;
    }

    highlight(index: number | null, options?: HighlightOptions) {
        const match = index === null ? null : this.locate(index);
        const next = match?.run ?? null;
        const previous = this.current;

        // `FindReveal` shows a highlighted match of the host over `revealEmbed()`.
        if (previous && previous.target !== next?.target) {
            previous.target.highlight(null);
        }
        // The content of an embed shows before its target scrolls to the match.
        if (next?.embed && next.embed !== previous?.embed) {
            this.host.revealEmbed(next.embed);
            revealContentEmbed(next.embed, true);
        }
        if (match) {
            const { embed } = match.run;
            if (embed && options?.isInstant) {
                scrollRectIntoView(
                    embed.parentElement, () => embed.getBoundingClientRect(), "instant"
                );
            }
            match.run.target.highlight(match.local, options);
        }
        if (previous?.embed && previous.embed !== next?.embed) {
            revealContentEmbed(previous.embed, false);
            if (!next?.embed) {
                this.host.revealEmbed(null);
            }
        }
        this.current = next;
    }

    getFirstMatchBelow(top: number) {
        const candidates = [
            this.toIndex(this.host, this.host.getFirstMatchBelow(top)),
            ...this.embeds.map(({ target }) => this.toIndex(target, target.getFirstMatchBelow(top)))
        ].filter((index) => index !== null);
        return candidates.length ? Math.min(...candidates) : null;
    }

    /**
     * The targets of the matches, in the order of their numbers. While the results are stale,
     * those that the host shows now, then those of the embeds.
     */
    getMatchTargets({ isStale }: { isStale: boolean }) {
        if (isStale) {
            return [
                ...this.host.getMatchTargets({ isStale }),
                ...this.embeds.flatMap(({ target }) => target.getMatchTargets({ isStale }))
            ];
        }

        const byTarget = new Map<FindTarget, ScrollRailTarget[]>();
        return this.runs.flatMap(({ target, first, count }) => {
            let targets = byTarget.get(target);
            if (!targets) {
                targets = target.getMatchTargets({ isStale });
                byTarget.set(target, targets);
            }
            return Array.from({ length: count }, (_, index) => targets[first + index] ?? null);
        });
    }

    countMatches() {
        this.countAll();
        return this.total;
    }

    /**
     * The match where the find starts, while there are matches: the one at the selection of the
     * host, otherwise the first at or below `top`, a client Y coordinate.
     */
    getStartMatch(top: number) {
        const selected = this.toIndex(this.host, this.host.getSelectedMatch?.() ?? null);
        return selected ?? this.getFirstMatchBelow(top) ?? 0;
    }

    canReplace(index: number) {
        const match = this.locate(index);
        return !!match && match.run.target.canReplace(match.local);
    }

    async replace(index: number, text: string, check?: FindCheck) {
        const match = this.locate(index);
        if (!match?.run.target.canReplace(match.local)) {
            return this.total;
        }

        await match.run.target.replace(match.local, text, check);
        this.countAll();
        return this.total;
    }

    async replaceAll(text: string, check?: FindCheck) {
        // The list is taken first: `close()` empties it while the host replaces.
        const embeds = [ ...this.embeds ];
        await this.host.replaceAll(text, check);
        for (const { target } of embeds) {
            await target.replaceAll(text, check);
        }
        this.countAll();
        return this.total;
    }

    /**
     * Closes every target, even after one of them fails, and returns the selection of the current
     * match that the target holding it gives back.
     */
    close(index: number | null) {
        const match = index === null ? null : this.locate(index);
        let selection: (() => void) | null = null;
        try {
            this.highlight(null);
        } catch (error) {
            console.error("Search in note: clearing the current match failed.", error);
        }
        for (const target of [ this.host, ...this.embeds.map((embed) => embed.target) ]) {
            try {
                selection = target.close(target === match?.run.target ? match.local : null)
                    ?? selection;
            } catch (error) {
                console.error("Search in note: closing a target failed.", error);
            }
        }
        this.embeds = [];
        this.hostCount = 0;
        this.current = null;
        this.layOut();
        return selection;
    }

    /** Watches the content of the host. The embeds are targets of their own. */
    watchContent(callback: () => void) {
        return this.host.watchContent?.(callback) ?? (() => {});
    }

    /** Counts the matches of every target anew, which rebuilds their lists, then lays them out. */
    private countAll() {
        this.hostCount = this.host.countMatches();
        for (const embed of this.embeds) {
            embed.count = embed.target.countMatches();
        }
        this.layOut();
    }

    /** Splits the matches of the host around each embed with matches. */
    private layOut() {
        const runs: Run[] = [];
        let total = 0;
        let hostIndex = 0;
        const add = (
            target: FindTarget, embed: HTMLElement | null, first: number, count: number
        ) => {
            if (count > 0) {
                runs.push({ target, embed, first, count, start: total });
                total += count;
            }
        };

        for (const { embed, target, count } of this.embeds) {
            const before = Math.max(this.host.countMatchesBefore(embed), hostIndex);
            add(this.host, null, hostIndex, before - hostIndex);
            hostIndex = before;
            add(target, embed, 0, count);
        }
        add(this.host, null, hostIndex, this.hostCount - hostIndex);

        this.runs = runs;
        this.total = total;
    }

    private locate(index: number) {
        const run = this.runs.find(({ start, count }) => index >= start && index < start + count);
        return run ? { run, local: run.first + index - run.start } : null;
    }

    private toIndex(target: FindTarget, local: number | null) {
        if (local === null) {
            return null;
        }
        const run = this.runs.find((candidate) => candidate.target === target
            && local >= candidate.first && local < candidate.first + candidate.count);
        return run ? run.start + local - run.first : null;
    }

}

/** The counters of the find bar for `total` matches, of which `current` is the current one. */
export function toFindResult(total: number, current: number | null): FindResult {
    return { totalFound: total, currentFound: current === null ? 0 : current + 1 };
}

/** The top of the scrolling container around `element`, as a client Y coordinate. */
export function getScrollingContainerTop(element: Element | null | undefined) {
    return element?.closest(".scrolling-container")?.getBoundingClientRect().top ?? 0;
}

/** An embed whose content a target searches, and the number of matches it found. */
interface EmbedSearch {
    embed: HTMLElement;
    target: FindTarget;
    count: number;
}

/**
 * Consecutive matches of one target: `count` matches from its match `first`, which are the matches
 * from `start` of the whole document. `embed` is the embed of the target, `null` for the host.
 */
interface Run {
    target: FindTarget;
    embed: HTMLElement | null;
    first: number;
    count: number;
    start: number;
}
