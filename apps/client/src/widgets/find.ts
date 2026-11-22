/**
 * (c) Antonio Tejada 2022
 * https://github.com/antoniotejada/Trilium-FindWidget
 */

import type { EventData, EventNames } from "../components/app_context.js";
import type NoteContext from "../components/note_context.js";
import attributeService from "../services/attributes.js";
import { t } from "../services/i18n.js";
import { isIMEComposing } from "../services/shortcuts.js";
import toast from "../services/toast.js";
import utils from "../services/utils.js";
import type FindInCode from "./find_in_code.js";
import type FindInHtml from "./find_in_html.js";
import type FindInText from "./find_in_text.js";
import type { FindCheck, HighlightOptions } from "./merged_find.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import type { ScrollRailLayer, ScrollRailSource } from "./scroll_rail_markers.js";
import type { FindChangeReason } from "./type_widgets/text/content_embed_tools.js";

const findWidgetDelayMillis = 200;

export interface FindResult {
    totalFound: number;
    currentFound: number;
}

/** The checks of a write: right before its first edit, and before it shows its result. */
export interface FindChecks {
    start: FindCheck;
    show: FindCheck;
}

/**
 * What a write did: dropped before its first edit, or done, with the result to show, `null` when
 * there is none to show.
 */
export interface WriteOutcome {
    isDropped: boolean;
    result: FindResult | null;
}

/** Whether the cleanup of a closed bar can still select a match and move the focus. */
export type CloseGuard = () => boolean;

/** How a step to a match is made, and whether it is still wanted after an await. */
export interface NavigationOptions extends HighlightOptions {
    check?: FindCheck;
}

/** Why the results went stale: the targets of the embeds, an edit, or a reload of the note. */
export type InvalidationReason = FindChangeReason | "reload";

type FindHandler = FindInText | FindInCode | FindInHtml;

/**
 * The work of the bar from its opening, or from a seeded search, to its close. Each request is
 * bound to its session, and the cleanup of a close to the handler of the session it closes.
 */
interface Session {
    id: number;
    handler: FindHandler;
    noteContext: NoteContext | undefined;
    noteId: string | null | undefined;
    /** Whether the bar shows: a seeded search runs without it until it has matches. */
    isShown: boolean;
    layer: ScrollRailLayer | null;
    isPublished: boolean;
}

/** The result in the counters, with the search and the query it is a result of. */
interface ShownResult extends FindResult {
    searchNumber: number;
    queryVersion: number;
}

// tabIndex=-1 on the checkbox labels is necessary, so when clicking on the label,
// the focusout handler is called with relatedTarget equal to the label instead
// of undefined. It's -1 instead of > 0, so they don't tabstop
/** The bar's markup, built as it renders, once the translations its labels take have loaded. */
const buildTemplate = () => /*html*/`
<div class='find-replace-widget' style="contain: none; border-top: 1px solid var(--main-border-color);">
    <style>
        .find-widget-box, .replace-widget-box {
            padding: 2px 10px 2px 10px;
            align-items: center;
        }

        .find-widget-box > *, .replace-widget-box > *{
            margin-inline-end: 15px;
        }

        .find-widget-box, .replace-widget-box {
            display: flex;
        }

        .find-widget-found-wrapper {
            justify-content: center;
            min-width: 60px;
            padding: 0 4px;
            font-size: .85em;
            text-align: center;
        }

        .find-widget-search-term-input-group, .replace-widget-replacetext-input {
            max-width: 350px;
        }

        .find-widget-spacer {
            flex-grow: 1;
        }
    </style>

    <div class="find-widget-box">
        <div class="input-group find-widget-search-term-input-group">
            <input type="text" class="form-control find-widget-search-term-input" placeholder="${t("find.find_placeholder")}">
            <button class="btn btn-outline-secondary bx bxs-chevron-up find-widget-previous-button" type="button"></button>
            <div class="find-widget-found-wrapper input-group-text">
                <span>
                    <span class="find-widget-current-found">0</span>
                    /
                    <span class="find-widget-total-found">0</span>
                <span>
            </div>
            <button class="btn btn-outline-secondary bx bxs-chevron-down find-widget-next-button" type="button"></button>
        </div>

        <div class="form-check">
            <label tabIndex="-1" class="form-check-label tn-checkbox">
                <input type="checkbox" class="form-check-input find-widget-case-sensitive-checkbox">
                ${t("find.case_sensitive")}
            </label>
        </div>

        <div class="form-check">
            <label tabIndex="-1" class="form-check-label tn-checkbox">
                <input type="checkbox" class="form-check-input find-widget-match-words-checkbox">
                ${t("find.match_words")}
            </label>
        </div>



        <div class="find-widget-spacer"></div>

        <div class="find-widget-close-button"><button class="icon-action bx bx-x"></button></div>
    </div>

    <div class="replace-widget-box" style='display: none'>
        <input type="text" class="form-control replace-widget-replacetext-input" placeholder="${t("find.replace_placeholder")}">
        <button class="btn btn-sm replace-widget-replaceall-button" type="button">${t("find.replace_all")}</button>
        <button class="btn btn-sm  replace-widget-replace-button" type="button">${t("find.replace")}</button>
    </div>
</div>`;

const SUPPORTED_NOTE_TYPES = ["text", "code", "render", "mindMap", "doc"];
const SUPPORTED_NOTE_IDS = ["_backendLog"];
/** The events that point a widget at a note context, which a pinned bar ignores for other contexts. */
const CONTEXT_EVENTS: EventNames[] = [
    "activeContextChanged", "noteSwitched", "noteSwitchedAndActivated", "setNoteContext"
];

export default class FindWidget extends NoteContextAwareWidget {

    private pinnedNtxId?: string;

    private textHandler?: FindInText;
    private codeHandler?: FindInCode;
    private htmlHandler?: FindInHtml;
    private timeoutId?: number | null;
    /** The class of the layer of the scroll rail, loaded with the backends of text notes. */
    private RailLayer?: typeof ScrollRailLayer;

    private session: Session | null = null;
    private sessionCount = 0;
    /** The requests of the bar, which run one at a time, in the order they are asked for. */
    private queue: Promise<void> = Promise.resolve();
    /** The number of the latest search asked for. */
    private latestSearch = 0;
    /** The latest search asked for while it has not shown its result or been dropped. */
    private pendingSearch: { number: number; queryVersion: number } | null = null;
    /** Raised by every input in the field and every change of an option. */
    private queryVersion = 0;
    private result: ShownResult | null = null;
    /** Whether the counters show `?`, as the content changed since the result. */
    private isStale = false;
    /** The invalidations held while a search or a write runs. */
    private operation: { held: InvalidationReason[] } | null = null;

    private $input!: JQuery<HTMLElement>;
    private $currentFound!: JQuery<HTMLElement>;
    private $totalFound!: JQuery<HTMLElement>;
    private $caseSensitiveCheckbox!: JQuery<HTMLElement>;
    private $matchWordsCheckbox!: JQuery<HTMLElement>;
    private $previousButton!: JQuery<HTMLElement>;
    private $nextButton!: JQuery<HTMLElement>;
    private $closeButton!: JQuery<HTMLElement>;
    private $replaceWidgetBox!: JQuery<HTMLElement>;
    private $replaceTextInput!: JQuery<HTMLElement>;
    private $replaceAllButton!: JQuery<HTMLElement>;
    private $replaceButton!: JQuery<HTMLElement>;

    /**
     * @param pinnedNtxId the note context to search, for a bar outside the tab row such as the one in
     * the quick edit popup. Without it, the bar follows the context its split activates.
     */
    constructor(pinnedNtxId?: string) {
        super();

        this.pinnedNtxId = pinnedNtxId;
    }

    handleEvent<T extends EventNames>(name: T, data: EventData<T>) {
        if (this.pinnedNtxId && CONTEXT_EVENTS.includes(name)
                && (data as { noteContext?: NoteContext }).noteContext?.ntxId !== this.pinnedNtxId) {
            return null;
        }

        return super.handleEvent(name, data);
    }

    async noteSwitched() {
        await super.noteSwitched();

        // The cleanup waits for the request before it, which the switch need not wait for.
        void this.closeSearch();
    }

    doRender() {
        this.$widget = $(buildTemplate());
        this.$widget.hide();
        this.$input = this.$widget.find(".find-widget-search-term-input");
        this.$currentFound = this.$widget.find(".find-widget-current-found");
        this.$totalFound = this.$widget.find(".find-widget-total-found");
        this.$caseSensitiveCheckbox = this.$widget.find(".find-widget-case-sensitive-checkbox");
        this.$caseSensitiveCheckbox.on("change", () => this.optionChanged());
        this.$matchWordsCheckbox = this.$widget.find(".find-widget-match-words-checkbox");
        this.$matchWordsCheckbox.on("change", () => this.optionChanged());
        this.$previousButton = this.$widget.find(".find-widget-previous-button");
        this.$previousButton.on("click", () => this.findNext(-1));
        this.$nextButton = this.$widget.find(".find-widget-next-button");
        this.$nextButton.on("click", () => this.findNext(1));
        this.$closeButton = this.$widget.find(".find-widget-close-button");
        this.$closeButton.on("click", () => this.closeSearch());

        this.$replaceWidgetBox = this.$widget.find(".replace-widget-box");
        this.$replaceTextInput = this.$widget.find(".replace-widget-replacetext-input");
        this.$replaceAllButton = this.$widget.find(".replace-widget-replaceall-button");
        this.$replaceAllButton.on("click", () => this.replaceAll());
        this.$replaceButton = this.$widget.find(".replace-widget-replace-button");
        this.$replaceButton.on("click", () => this.replace());

        this.$input.on("keydown", async (e) => {
            // Skip processing during IME composition
            if (isIMEComposing(e.originalEvent as KeyboardEvent)) {
                return;
            }

            if ((e.metaKey || e.ctrlKey) && (e.key === "F" || e.key === "f")) {
                // If ctrl+f is pressed when the findbox is shown, select the
                // whole input to find
                this.$input.select();
            } else if (e.key === "Enter" || e.key === "F3") {
                e.preventDefault();
                await this.findNext(e?.shiftKey ? -1 : 1);
                return false;
            }
        });

        this.$widget.on("keydown", async (e) => {
            if (e.key === "Escape") {
                // Closing the bar is all Escape does here, not also closing a dialog the bar is in.
                e.stopPropagation();
                await this.closeSearch();
            }
        });

        this.$input.on("input", () => this.startSearch());

        return this.$widget;
    }

    async findInTextEvent(data: EventData<"findInText"> = {}) {
        // Route by explicit ntxId when the command targets a specific context (the seeded
        // jump-to-match flow fired on note open carries it); otherwise fall back to the active
        // context, as manual Ctrl+F / toolbar invocations do.
        const isTargeted = data.ntxId ? this.isNoteContext(data.ntxId) : this.isActiveNoteContext();
        if (!isTargeted) {
            return;
        }

        const isSourceView = this.noteContext?.viewScope?.viewMode === "source";

        const isSupportedNoteId = SUPPORTED_NOTE_IDS.includes(this.note?.noteId ?? "");
        if (!isSourceView && !isSupportedNoteId && !SUPPORTED_NOTE_TYPES.includes(this.note?.type ?? "")) {
            return;
        }

        const handler = await this.getHandler();
        if (!handler) {
            return;
        }

        if (data.searchTerms?.length) {
            await this.seededFind(handler, data.searchTerms);
            return;
        }

        const isReadOnly = await this.noteContext?.isReadOnly();

        let selectedText = "";
        if ((this.note?.type === "code" || isSupportedNoteId || isSourceView) && this.noteContext) {
            const codeEditor = await this.noteContext.getCodeEditor();
            selectedText = codeEditor.getSelectedText();
        } else {
            selectedText = window.getSelection()?.toString() || "";
        }

        // A session of another backend, or of a seeded search that never showed, ends first.
        if (this.session && (this.session.handler !== handler || !this.session.isShown)) {
            void this.endSession();
        }
        const session = this.session ?? this.openSession(handler);
        session.isShown = true;

        this.$widget.show();
        this.$input.focus();
        if ([ "text", "code" ].includes(this.note?.type ?? "") && !isReadOnly) {
            this.$replaceWidgetBox.show();
        } else {
            this.$replaceWidgetBox.hide();
        }

        const isAlreadyVisible = this.$widget.is(":visible");

        if (isAlreadyVisible) {
            if (selectedText) {
                this.setQuery(selectedText);
            }

            if (this.$input.val()) {
                await this.askSearch(session);
            }

            this.$input.select();
        } else {
            this.$totalFound.text("0");
            this.$currentFound.text("0");
            this.setQuery(selectedText);

            if (selectedText) {
                this.$input.select();
                await this.askSearch(session);
            }
        }
    }

    /**
     * Searches for the terms carried in on note open (jump-to-match) with the bar hidden. The bar
     * shows only once the first term has matches, on the first of them, so Enter/F3 cycles the
     * results at once; the other terms are highlighted with it.
     */
    private async seededFind(handler: FindHandler, searchTerms: string[]) {
        const [ seed = "", ...extraTokens ] = searchTerms;
        if (this.session) {
            void this.endSession();
        }
        const session = this.openSession(handler);
        this.setQuery(seed);

        await this.askSearch(session, async (found, check) => {
            if (found.totalFound < 1) {
                return;
            }

            this.$widget.show();
            session.isShown = true;
            if (!utils.isMobile()) {
                this.$input.focus();
                this.$input.select();
            }
            this.updateRail(session);

            // Multi-token highlight-all is only supported by the read-only HTML handler; the
            // editable CKEditor and CodeMirror find engines highlight the single seed term only.
            if (extraTokens.length && check() && "highlightExtraTokens" in handler) {
                await handler.highlightExtraTokens(extraTokens);
            }
        });
    }

    async readOnlyTemporarilyDisabledEvent({ noteContext }: EventData<"readOnlyTemporarilyDisabled">) {
        if (this.isNoteContext(noteContext.ntxId)) {
            await this.closeSearch();
        }
    }

    async getHandler() {
        // In source view, all note types render via a read-only CodeMirror editor.
        if (this.noteContext?.viewScope?.viewMode === "source") {
            return this.getCodeHandler();
        }

        // Notes that use a CodeMirror editor but aren't of type "code".
        if (SUPPORTED_NOTE_IDS.includes(this.note?.noteId ?? "")) {
            return this.getCodeHandler();
        }

        switch (this.note?.type) {
            case "render":
                return this.getHtmlHandler();
            case "code":
                return this.getCodeHandler();
            case "text":
                const readOnly = await this.noteContext?.isReadOnly();
                return readOnly ? this.getHtmlHandler() : this.getTextHandler();
            case "mindMap":
            case "doc":
                return this.getHtmlHandler();
            default:
                console.warn("FindWidget: Unsupported note type for find widget", this.note?.type);
        }
    }

    // Each backend loads the first time a note needs it, since the bar stays closed until asked for.
    private async getTextHandler() {
        const [ { default: FindInText } ] = await Promise.all([
            import("./find_in_text.js"), this.loadRailLayer()
        ]);
        this.textHandler ??= new FindInText(this);
        return this.textHandler;
    }

    private async getCodeHandler() {
        const { default: FindInCode } = await import("./find_in_code.js");
        this.codeHandler ??= new FindInCode(this);
        return this.codeHandler;
    }

    private async getHtmlHandler() {
        const [ { default: FindInHtml } ] = await Promise.all([
            import("./find_in_html.js"), this.loadRailLayer()
        ]);
        this.htmlHandler ??= new FindInHtml(this);
        return this.htmlHandler;
    }

    private async loadRailLayer() {
        this.RailLayer ??= (await import("./scroll_rail_markers.js")).ScrollRailLayer;
    }

    /** Searches the field once the typing pauses. The lines of the rail retire at once. */
    startSearch() {
        this.raiseQueryVersion();
        // TODO: Fix once client is separated from Node.js types.
        clearTimeout(this.timeoutId as unknown as NodeJS.Timeout);

        // Defer the search a few millis so the search doesn't start
        // immediately, as this can cause search word typing lag with
        // one or two-char searchwords and long notes
        // See https://github.com/antoniotejada/Trilium-FindWidget/issues/1
        // TODO: Fix once client is separated from Node.js types.
        this.timeoutId = setTimeout(() => {
            this.timeoutId = null;
            void this.askSearch();
        }, findWidgetDelayMillis) as unknown as number;
    }

    /**
     * Steps through the matches of the query in the field. With the query not searched yet, or
     * the counters at `?`, searches it instead and stops at its start match.
     *
     * @param direction +1 for next, -1 for previous
     */
    async findNext(direction: 1 | -1) {
        const session = this.session;
        if (!session) {
            return;
        }

        const isFieldPending = this.pendingSearch?.queryVersion === this.queryVersion;
        const isFieldShown = this.result?.queryVersion === this.queryVersion && !this.isStale;
        if (!isFieldShown && !isFieldPending) {
            await this.askSearch(session);
            return;
        }

        await this.navigate(session, (total, current) => {
            let next = current + direction;
            // Wrap around
            if (next > total - 1) {
                next = 0;
            } else if (next < 0) {
                next = total - 1;
            }
            return next;
        }, {});
    }

    /** Asks for a search of the query in the field, which runs at its turn in the queue. */
    private askSearch(
        session = this.session,
        onCommit?: (found: FindResult, check: FindCheck) => Promise<void> | void
    ) {
        if (!session) {
            return Promise.resolve();
        }

        clearTimeout(this.timeoutId as unknown as NodeJS.Timeout);
        this.timeoutId = null;
        const number = ++this.latestSearch;
        const { queryVersion } = this;
        const term = String(this.$input.val());
        const matchCase = !!this.$caseSensitiveCheckbox.prop("checked");
        const wholeWord = !!this.$matchWordsCheckbox.prop("checked");
        this.pendingSearch = { number, queryVersion };
        session.layer?.retire();

        const check = () => this.isOpen(session)
            && this.latestSearch === number && this.queryVersion === queryVersion;
        return this.enqueue(() => this.runOperation(async () => {
            try {
                if (check()) {
                    session.layer?.retire();
                    const found = await session.handler.performFind(
                        term, matchCase, wholeWord, check
                    );
                    if (found && check()) {
                        this.showResult(session, found, number, queryVersion);
                        await onCommit?.(found, check);
                        return true;
                    }
                }
                return false;
            } finally {
                // A failed search leaves no pending one, so the next Enter searches again.
                if (this.pendingSearch?.number === number) {
                    this.pendingSearch = null;
                }
            }
        }));
    }

    /**
     * Makes another match the current one, on the result shown when it is asked for, once the
     * requests before it are done. `getNext` takes the counters at that moment.
     */
    private navigate(
        session: Session,
        getNext: (total: number, current: number) => number,
        options: HighlightOptions
    ) {
        const latestAtAsk = this.latestSearch;
        const { queryVersion } = this;
        const check = () => this.isOpen(session)
            && this.latestSearch === latestAtAsk && this.queryVersion === queryVersion;
        return this.enqueue(async () => {
            const { result } = this;
            if (!check() || !result || result.totalFound < 1) {
                return;
            }
            if (this.isStale) {
                void this.askSearch(session);
                return;
            }

            const current = result.currentFound - 1;
            const next = getNext(result.totalFound, current);
            const isStepped = await session.handler.findNext(
                0, current, next, { ...options, check }
            );
            if (!isStepped || !check() || this.result !== result) {
                return;
            }
            result.currentFound = next + 1;
            this.$currentFound.text(String(next + 1));
            this.updateReplaceButton();
            session.layer?.emphasize(next);
        });
    }

    /**
     * Makes match `index` the current one, for a click on a fresh line of the scroll rail.
     * Declines while the results are not those of the field, so the rail goes to the line's match.
     */
    private goToMatch(session: Session, index: number) {
        const isFresh = this.session === session && !this.isStale && !this.operation
            && !this.pendingSearch && this.result?.queryVersion === this.queryVersion;
        if (!isFresh) {
            return false;
        }

        void this.navigate(session, () => index, { isInstant: true });
        return true;
    }

    /**
     * Marks the counters as out of date, as when the content of an embed changed, so that the next
     * Enter searches again. During a search or a write, `reason` waits in `operation.held` until
     * the result shows.
     */
    invalidateResults(reason: InvalidationReason = "content") {
        if (!this.session) {
            return;
        }
        if (this.operation) {
            this.operation.held.push(reason);
            return;
        }
        this.markStale();
    }

    private markStale() {
        this.isStale = true;
        this.$totalFound.text("?");
        this.session?.layer?.emphasize(null);
        this.session?.layer?.refreshLater();
    }

    private showResult(
        session: Session, found: FindResult, searchNumber: number, queryVersion: number
    ) {
        this.result = { ...found, searchNumber, queryVersion };
        this.isStale = false;
        if (this.pendingSearch?.number === searchNumber) {
            this.pendingSearch = null;
        }
        this.$totalFound.text(String(found.totalFound));
        this.$currentFound.text(String(found.currentFound));
        this.updateReplaceButton();
        this.updateRail(session);
    }

    /** Publishes the layer of the scroll rail while a text note has matches and the bar shows. */
    private updateRail(session: Session) {
        const { result, RailLayer } = this;
        const isRailNote = this.note?.type === "text"
            && (this.noteContext?.viewScope?.viewMode ?? "default") === "default";
        if (!result || result.totalFound < 1 || !session.isShown || !isRailNote || !RailLayer) {
            this.unpublishRail(session);
            return;
        }

        session.layer ??= new RailLayer(this.createRailSource(session));
        if (!session.isPublished) {
            session.noteContext?.setContextData("scrollRailFind", session.layer);
            session.isPublished = true;
        }
        session.layer.refresh();
        session.layer.emphasize(result.currentFound > 0 ? result.currentFound - 1 : null);
    }

    private createRailSource(session: Session): ScrollRailSource {
        return {
            readTargets: () => {
                const { handler } = session;
                return this.session === session && "getMatchTargets" in handler
                    ? handler.getMatchTargets({ isStale: this.isStale })
                    : [];
            },
            onClick: (index) => this.goToMatch(session, index)
        };
    }

    private unpublishRail(session: Session) {
        if (session.isPublished) {
            session.noteContext?.clearContextData("scrollRailFind");
            session.isPublished = false;
        }
    }

    /** Disables "Replace" while the current match is in content that cannot change. */
    private updateReplaceButton() {
        const handler = this.session?.handler;
        const canReplace = handler && "canReplace" in handler
            ? handler.canReplace()
            : true;
        this.$replaceButton.prop("disabled", !canReplace);
    }

    /**
     * Hides the bar and ends its session. The cleanup runs once the requests before it are done.
     */
    async closeSearch() {
        clearTimeout(this.timeoutId as unknown as NodeJS.Timeout);
        this.timeoutId = null;
        this.$widget.hide();
        await this.endSession();
    }

    async replace() {
        await this.askWrite("replace");
    }

    async replaceAll() {
        await this.askWrite("replaceAll");
    }

    /**
     * Asks for a write on the result of the query in the field. Replace needs that result shown,
     * with its current match; Replace All also waits for a search of it, or asks for one. A write
     * whose search does not commit, or whose result goes stale before it starts, is dropped.
     */
    private askWrite(kind: "replace" | "replaceAll") {
        const session = this.session;
        const handler = session?.handler;
        if (!session || !handler || !("replace" in handler)) {
            return;
        }

        const { queryVersion } = this;
        const isFieldPending = this.pendingSearch?.queryVersion === queryVersion;
        session.layer?.retire();
        let bound: number;
        if (this.result?.queryVersion === queryVersion && !this.isStale) {
            bound = this.result.searchNumber;
        } else if (kind === "replaceAll" && isFieldPending && this.pendingSearch) {
            bound = this.pendingSearch.number;
        } else {
            if (!isFieldPending) {
                void this.askSearch(session);
            }
            // Replace waits for the user to see the match that the search makes current.
            if (kind === "replace") {
                return;
            }
            bound = this.latestSearch;
        }

        const latestAtAsk = this.latestSearch;
        const text = String(this.$replaceTextInput.val());
        const checks: FindChecks = {
            start: () => this.isOpen(session) && this.result?.searchNumber === bound
                && !this.isStale && this.queryVersion === queryVersion,
            show: () => this.isOpen(session)
                && this.latestSearch === latestAtAsk && this.queryVersion === queryVersion
        };
        return this.enqueue(() => this.runOperation(async () => {
            if (!checks.start()) {
                this.reportDroppedWrite();
                return false;
            }
            session.layer?.retire();
            const outcome = await handler[kind](text, checks);
            if (outcome.isDropped) {
                this.reportDroppedWrite();
                return false;
            }
            if (!outcome.result || !checks.show()) {
                return false;
            }
            this.showResult(session, outcome.result, bound, queryVersion);
            return true;
        }));
    }

    private reportDroppedWrite() {
        toast.showMessage(t("find.nothing_replaced"));
    }

    isEnabled() {
        return super.isEnabled()
            && (SUPPORTED_NOTE_TYPES.includes(this.note?.type ?? "")
                || SUPPORTED_NOTE_IDS.includes(this.note?.noteId ?? "")
                || this.noteContext?.viewScope?.viewMode === "source");
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (this.noteId && loadResults.isNoteContentReloaded(this.noteId)) {
            this.invalidateResults("reload");
        } else if (loadResults.getAttributeRows().find((attr) => attr.type === "label"
                && (attr.name?.toLowerCase() ?? "").includes("readonly")
                && attributeService.isAffecting(attr, this.note))) {
            this.closeSearch();
        }
    }

    private openSession(handler: FindHandler) {
        this.session = {
            id: ++this.sessionCount,
            handler,
            noteContext: this.noteContext,
            noteId: this.noteContext?.noteId,
            isShown: false,
            layer: null,
            isPublished: false
        };
        this.result = null;
        this.isStale = false;
        this.pendingSearch = null;
        return this.session;
    }

    /**
     * Ends the session at once and queues its cleanup, with its handler. The cleanup selects a
     * match and gives the focus back only while no session opened since, the note context shows
     * the same note, and the bar showed.
     */
    private endSession() {
        const session = this.session;
        if (!session) {
            return Promise.resolve();
        }

        this.session = null;
        this.unpublishRail(session);
        this.result = null;
        this.isStale = false;
        this.pendingSearch = null;
        const guard = () => this.sessionCount === session.id
            && this.noteContext === session.noteContext
            && this.noteContext?.noteId === session.noteId
            && session.isShown;
        return this.enqueue(() => session.handler.findBoxClosed(guard));
    }

    /** Whether a request of `session` still applies: the session is open on the same note. */
    private isOpen(session: Session) {
        return this.session === session
            && this.noteContext === session.noteContext
            && this.noteContext?.noteId === session.noteId;
    }

    private optionChanged() {
        this.raiseQueryVersion();
        void this.askSearch();
    }

    /**
     * Sets the field to `query`, which makes the lines of the rail and any write of the old query
     * stale.
     */
    private setQuery(query: string) {
        this.$input.val(query);
        this.raiseQueryVersion();
    }

    private raiseQueryVersion() {
        this.queryVersion++;
        this.session?.layer?.retire();
    }

    /**
     * Runs a search or a write. The invalidations that it raises are held: an edit is in its
     * counts, and anything else makes the result stale once it is shown.
     */
    private async runOperation(body: () => Promise<boolean>) {
        const operation = { held: [] as InvalidationReason[] };
        this.operation = operation;
        try {
            const isShown = await body();
            if (isShown && operation.held.some((reason) => reason !== "content")) {
                this.markStale();
            }
        } finally {
            if (this.operation === operation) {
                this.operation = null;
            }
        }
    }

    /**
     * Runs `step` after the requests before it. A failure is logged and leaves the results stale.
     */
    private enqueue(step: () => Promise<void>) {
        const run = this.queue.then(step).catch((error: unknown) => {
            console.error("Search in note failed.", error);
            if (this.session) {
                this.isStale = true;
                this.$totalFound.text("?");
            }
        });
        this.queue = run;
        return run;
    }

}
