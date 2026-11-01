import "./filter.css";

import { type ComponentChildren, createContext, isValidElement } from "preact";
import { useContext, useMemo } from "preact/hooks";

/**
 * What a subtree is being narrowed down to, provided by {@link FilterProvider}.
 *
 * Most components never read this directly: they ask {@link useFilterMatch} whether to render. Read
 * it when the terms themselves are needed, for example to hand them to
 * `useImperativeSearchHighlighlighting` so the matched words are marked in place.
 */
export interface FilterState {
    /**
     * The terms being filtered by, lowercased and stripped of accents. Never empty, since a query
     * with no terms in it filters nothing and is provided as `null` instead.
     */
    tokens: string[];
    /** Whether the given content holds every term. See {@link matchesFilter}. */
    matches(...content: ComponentChildren[]): boolean;
}

/** Null wherever nothing is filtered, which is everywhere outside a {@link FilterProvider}. */
const FilterContext = createContext<FilterState | null>(null);

interface FilterProviderProps {
    /** What the user typed. Blank or missing means nothing is filtered. */
    query?: string | null;
    children: ComponentChildren;
}

/**
 * Filters everything rendered below it by `query`, without those components needing to know where
 * the query came from or that a filter exists at all.
 *
 * Each participating component asks {@link useFilterMatch} whether its own text matches, and
 * returns `null` when it does not. Components that do not ask are left alone, so a filter can be
 * added over an existing tree and only the parts opted in respond to it.
 *
 * Nothing here is debounced: pass a value already settled with `useDebouncedValue` when the filter
 * covers enough content that filtering on every keystroke would be felt.
 *
 * @example
 * const [ query, setQuery ] = useState("");
 *
 * <FormTextBox currentValue={query} onChange={setQuery} />
 * <FilterProvider query={useDebouncedValue(query, 200)}>
 *     <Settings />
 * </FilterProvider>
 */
export function FilterProvider({ query, children }: FilterProviderProps) {
    const state = useMemo(() => createFilterState(query ?? ""), [ query ]);

    return <FilterContext.Provider value={state}>{children}</FilterContext.Provider>;
}

interface FilterPassthroughProps {
    /**
     * Whether to lift the filter for the children. A prop rather than a condition around this
     * component, so that turning it on and off leaves the tree in place: wrapping and unwrapping
     * children instead would remount them, losing focus and any state they hold.
     */
    when?: boolean;
    children: ComponentChildren;
}

/**
 * Shows the children in full, as though nothing were being filtered.
 *
 * This is how a container that matched by its own title passes the whole of what it holds: the user
 * asked for this group, so the parts inside it should no longer have to match on their own. Filters
 * further down still apply, since each provider only lifts its own.
 *
 * @example
 * const matched = useFilterMatch(heading);
 *
 * <div className="group">
 *     <h5>{heading}</h5>
 *     <FilterPassthrough when={matched}>{children}</FilterPassthrough>
 * </div>
 */
export function FilterPassthrough({ when = true, children }: FilterPassthroughProps) {
    const state = useContext(FilterContext);

    return <FilterContext.Provider value={when ? null : state}>{children}</FilterContext.Provider>;
}

/**
 * Whether the content given survives the filter it sits under, which is always true when nothing is
 * being filtered. Pass everything the user could reasonably search this piece of content by; plain
 * strings and JSX are both accepted (see {@link filterText} for what is read out of JSX).
 *
 * @example
 * function Setting({ label, description, children }: SettingProps) {
 *     if (!useFilterMatch(label, description)) return null;
 *     return <label>{label}<small>{description}</small>{children}</label>;
 * }
 */
export function useFilterMatch(...content: ComponentChildren[]): boolean {
    const state = useContext(FilterContext);

    return !state || state.matches(...content);
}

/**
 * The filter in force, or `null` when there is none. For components doing their own filtering, such
 * as a list narrowing its data before rendering rows, or one highlighting the matched terms.
 */
export function useFilterState(): FilterState | null {
    return useContext(FilterContext);
}

/**
 * Whether anything is being filtered here. Useful for styling a component differently while a
 * filter is running, for example to hide a group left empty by it through CSS rather than in code.
 */
export function useIsFiltering(): boolean {
    return useContext(FilterContext) !== null;
}

/**
 * What a piece of content is worth to the filter around it, marked on the element for CSS to act on
 * (see filter.css). A component states the part its content plays and is spared the rules:
 *
 * - `match`: content that matched, and so is a result in its own right.
 * - `scope`: a group of content, which goes as soon as it holds no match.
 * - `companion`: content that is no result of its own but belongs beside those that are, such as a
 *   preview of what the settings around it do. It is shown for as long as its group is, and never
 *   keeps that group alive by itself.
 *
 * The marks do nothing outside a filter, so a component may leave them on.
 */
export type FilterRole = "match" | "scope" | "companion";

/** The class standing for a {@link FilterRole}, or nothing for content playing no part. */
export function filterRoleClass(role: FilterRole | undefined | false) {
    return role ? `tn-filter-${role}` : undefined;
}

/**
 * Splits a query into the terms to match by, lowercased and stripped of accents so that typing
 * "Modele" finds "Modèle". Returns an empty array for a query holding no terms.
 */
export function filterTokens(query: string): string[] {
    return normalize(query).split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Whether every term appears somewhere in the content given, each as part of a word rather than a
 * whole one, so "back" finds "backup". Content with no terms to match against passes.
 *
 * The terms must come from {@link filterTokens}, which is what makes the comparison ignore case and
 * accents on both sides.
 */
export function matchesFilter(tokens: string[], ...content: ComponentChildren[]): boolean {
    if (tokens.length === 0) return true;

    const haystack = normalize(content.map((item) => filterText(item)).join(" "));

    return tokens.every((token) => haystack.includes(token));
}

/**
 * Reads the plain text out of anything renderable: strings and numbers as they are, arrays and the
 * children of JSX elements joined together.
 *
 * A custom component is opaque, since what it renders is only known once it does. `<b>Backups</b>`
 * therefore reads as "Backups" while `<PageTitle />` reads as nothing, so a label built from a
 * component should be passed to {@link useFilterMatch} alongside its text in plain form.
 */
export function filterText(content: ComponentChildren): string {
    if (typeof content === "string") return content;
    if (typeof content === "number" || typeof content === "bigint") return String(content);
    if (Array.isArray(content)) return content.map((child) => filterText(child)).join(" ");
    if (isValidElement(content)) return filterText(content.props?.children);

    return "";
}

function createFilterState(query: string): FilterState | null {
    const tokens = filterTokens(query);
    if (tokens.length === 0) return null;

    return {
        tokens,
        matches: (...content) => matchesFilter(tokens, ...content)
    };
}

function normalize(text: string): string {
    return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
