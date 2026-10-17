import type { FindResult } from "./find";
import { getEmbedFindTarget, revealContentEmbed } from "./type_widgets/text/content_embed_tools";

/** The options of a search of "Search in note". */
export interface FindOptions {
    matchCase: boolean;
    wholeWord: boolean;
}

/**
 * What "Search in note" searches: a text editor, the rendered content of a note, a code editor or
 * the content of an embed. Its matches are numbered from 0, in document order.
 */
export interface FindTarget {
    /**
     * Searches for `term` and returns the number of matches, none of them the current one. An empty
     * `term` removes the matches.
     */
    find(term: string, options: FindOptions): Promise<number>;
    /** Makes match `index` the current one and scrolls to it. `null` leaves no current match. */
    highlight(index: number | null): void;
    /** The first match at or below `top`, a client Y coordinate, or `null` when all are above. */
    getFirstMatchBelow(top: number): number | null;
    /** Whether `replace()` replaces match `index`, which a match in read-only content is not. */
    canReplace(index: number): boolean;
    /** Replaces match `index` with `text`, and returns the number of matches left. */
    replace(index: number, text: string): Promise<number>;
    /** Replaces each match that `canReplace()` allows, and returns the number of matches left. */
    replaceAll(text: string): Promise<number>;
    /**
     * Removes the matches. With `index`, selects that match and focuses the target where it can,
     * and returns whether it did.
     */
    close(index: number | null): boolean;
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

    async find(term: string, options: FindOptions) {
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

        const [ hostCount, ...counts ] = await Promise.all([
            this.host.find(term, options),
            ...embeds.map(({ target }) => target.find(term, options))
        ]);
        if (searchId === this.searchId) {
            this.hostCount = hostCount;
            for (const [ index, embed ] of embeds.entries()) {
                embed.count = counts[index] ?? 0;
            }
            this.layOut();
        }
        return this.total;
    }

    highlight(index: number | null) {
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
            match.run.target.highlight(match.local);
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

    async replace(index: number, text: string) {
        const match = this.locate(index);
        if (!match?.run.target.canReplace(match.local)) {
            return this.total;
        }

        const { target } = match.run;
        const count = await target.replace(match.local, text);
        if (target === this.host) {
            this.hostCount = count;
        }
        for (const embed of this.embeds) {
            if (embed.target === target) {
                embed.count = count;
            }
        }
        this.layOut();
        return this.total;
    }

    async replaceAll(text: string) {
        this.hostCount = await this.host.replaceAll(text);
        for (const embed of this.embeds) {
            embed.count = await embed.target.replaceAll(text);
        }
        this.layOut();
        return this.total;
    }

    close(index: number | null) {
        const match = index === null ? null : this.locate(index);
        this.highlight(null);

        let isFocused = false;
        for (const target of [ this.host, ...this.embeds.map((embed) => embed.target) ]) {
            const isClosedOnMatch = target.close(target === match?.run.target ? match.local : null);
            isFocused ||= isClosedOnMatch;
        }
        this.embeds = [];
        this.hostCount = 0;
        this.layOut();
        return isFocused;
    }

    /** Watches the content of the host. The embeds are targets of their own. */
    watchContent(callback: () => void) {
        return this.host.watchContent?.(callback) ?? (() => {});
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
