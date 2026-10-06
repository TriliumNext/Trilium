import "../theme/find_in_link_widgets.css";

import {
    _sortFindResultsByMarkerPositions as sortFindResults,
    Collection,
    FindAndReplaceEditing,
    FindAndReplaceUtils,
    Plugin,
    setHighlightHandling,
    uid,
    type CommandExecuteEvent,
    type DowncastHighlightDescriptor,
    type DowncastInsertEvent,
    type FindAttributes,
    type FindResultType,
    type Marker,
    type Model,
    type ModelItem,
    type ViewElement
} from "ckeditor5";

/** Adds search results for rendered link text that is not stored as CKEditor model text. */
export default class FindInLinkWidgets extends Plugin {

    static get requires() {
        return [ FindAndReplaceEditing ] as const;
    }

    static get pluginName() {
        return "FindInLinkWidgets" as const;
    }

    /** Matches the running query against widget text, or `null` while no search is running. */
    private _findByText: FindByText | null = null;

    /** The spans wrapping each highlighted widget's matches, so they can be unwrapped again. */
    private _matchSpans = new WeakMap<ViewElement, HTMLElement[]>();

    afterInit() {
        this._highlightMatchesInsteadOfWidget();

        const findCommand = this.editor.commands.get("find");
        const replaceCommand = this.editor.commands.get("replace");
        const replaceAllCommand = this.editor.commands.get("replaceAll");
        /* v8 ignore next -- FindAndReplaceEditing registers all three required commands. */
        if (!findCommand || !replaceCommand || !replaceAllCommand) {
            return;
        }

        findCommand.on<CommandExecuteEvent>(
            "execute",
            (eventInfo, [ query, options ]) => {
                if (typeof query !== "string" || !query) {
                    return;
                }

                this._addWidgetResults(
                    query,
                    options as FindAttributes | undefined,
                    (eventInfo.return as { results: Collection<FindResultType> }).results
                );
            },
            { priority: "lowest" }
        );

        replaceCommand.on<CommandExecuteEvent>(
            "execute",
            (eventInfo, [ , result ]) => {
                if (isWidgetResult(result as MarkedFindResult)) {
                    eventInfo.stop();
                    this.editor.execute("findNext");
                }
            },
            { priority: "high" }
        );

        replaceAllCommand.on<CommandExecuteEvent>(
            "execute",
            (_eventInfo, args) => {
                const results = args[1];
                if (!(results instanceof Collection)) {
                    return;
                }

                const replaceableResults = [ ...results ].filter(
                    (result) => !isWidgetResult(result as MarkedFindResult)
                );
                if (replaceableResults.length !== results.length) {
                    args[1] = new Collection(replaceableResults);
                }
            },
            { priority: "high" }
        );
    }

    /**
     * Replaces the class-on-the-whole-widget highlight `toWidget()` installs with one that wraps
     * only the matching characters. The rendered title lives in a `ViewUIElement`, whose DOM the
     * renderer and the mutation observer both skip, so the wrapper spans survive there.
     */
    private _highlightMatchesInsteadOfWidget() {
        const addHighlight = (element: ViewElement, descriptor: DowncastHighlightDescriptor) => {
            this._unwrapMatches(element);
            this._wrapMatches(element, descriptor);
        };
        const removeHighlight = (element: ViewElement) => this._unwrapMatches(element);

        for (const widgetName of SEARCHABLE_WIDGETS) {
            this.editor.editing.downcastDispatcher.on<DowncastInsertEvent>(
                `insert:${widgetName}`,
                (_eventInfo, data, conversionApi) => {
                    /* v8 ignore next -- An insert event for a widget carries its element. */
                    if (!data.item.is("element")) {
                        return;
                    }
                    const viewElement = conversionApi.mapper.toViewElement(data.item);
                    /* v8 ignore next -- The widget converter maps every element it inserts. */
                    if (!viewElement) {
                        return;
                    }

                    setHighlightHandling(
                        viewElement, conversionApi.writer, addHighlight, removeHighlight
                    );
                },
                { priority: "lowest" }
            );
        }
    }

    private _wrapMatches(element: ViewElement, descriptor: DowncastHighlightDescriptor) {
        const findByText = this._findByText;
        const item = this.editor.editing.mapper.toModelElement(element);
        /* v8 ignore next -- A highlighted widget is mapped and belongs to the running search. */
        if (!findByText || !item) {
            return;
        }

        const spans: HTMLElement[] = [];
        const matches = findMatches(textNodesOf(this.editor, element), item, findByText);
        // Wrap from the end so that splitting a text node leaves the earlier offsets in it valid.
        for (const { node, start, end } of matches.reverse()) {
            const match = node.splitText(start);
            match.splitText(end - start);

            const span = node.ownerDocument.createElement("span");
            span.className = [ descriptor.classes ].flat().join(" ");
            match.replaceWith(span);
            span.append(match);
            spans.push(span);
        }

        this._matchSpans.set(element, spans);
    }

    private _unwrapMatches(element: ViewElement) {
        for (const span of this._matchSpans.get(element) ?? []) {
            const parent = span.parentNode;
            /* v8 ignore next -- Spans are unwrapped once, while still in the widget's DOM. */
            if (!parent) {
                continue;
            }

            while (span.firstChild) {
                parent.insertBefore(span.firstChild, span);
            }
            span.remove();
            // Merge the split text back, so repeated searches do not fragment the widget's DOM.
            parent.normalize();
        }
        this._matchSpans.delete(element);
    }

    private _addWidgetResults(
        query: string,
        options: FindAttributes | undefined,
        commandResults: Collection<FindResultType>
    ) {
        const { editor } = this;
        const { model } = editor;
        const state = editor.plugins.get(FindAndReplaceEditing).state;
        /* v8 ignore next -- The required plugin creates its state in init(). */
        if (!state) {
            return;
        }
        this._findByText = editor.plugins
            .get(FindAndReplaceUtils)
            .findByTextCallback(query, options ?? {});

        for (const root of model.document.getRoots()) {
            for (const item of model.createRangeIn(root).getItems()) {
                if (!item.is("element") || !SEARCHABLE_WIDGETS.has(item.name)) {
                    continue;
                }
                const viewElement = editor.editing.mapper.toViewElement(item);
                // One marker identifies one atomic widget, so repeated matches remain one result.
                const matches = viewElement
                    ? findMatches(textNodesOf(editor, viewElement), item, this._findByText)
                    : [];
                if (matches.length === 0) {
                    continue;
                }

                const markerName = `findResult:widget-${uid()}`;
                const marker: Marker = model.change((writer) =>
                    writer.addMarker(markerName, {
                        usingOperation: false,
                        affectsData: false,
                        range: model.createRangeOn(item)
                    })
                );

                const result: FindResultType = { id: markerName, label: query, marker };
                state.results.add(result, insertionIndex(model, state.results, result));
                commandResults.add(result, insertionIndex(model, commandResults, result));
            }
        }

        state.highlightedResult = state.results.first;
    }

}

/** Reports every match as a character range, as `findByTextCallback()` does. */
type FindByText = (args: { item: ModelItem; text: string }) => FindResultType[];

type WidgetMatch = { node: Text; start: number; end: number };

function findMatches(nodes: Text[], item: ModelItem, findByText: FindByText): WidgetMatch[] {
    const matches: WidgetMatch[] = [];
    for (const node of nodes) {
        for (const { start = 0, end = 0 } of findByText({ item, text: node.data })) {
            matches.push({ node, start, end });
        }
    }
    return matches;
}

/** Returns the DOM text nodes a widget displays, in the order the reader sees them. */
function textNodesOf(editor: FindInLinkWidgets["editor"], viewElement: ViewElement): Text[] {
    const domElement = editor.editing.view.domConverter.mapViewToDom(viewElement);
    if (!domElement) {
        return [];
    }

    return textNodesIn(domElement);
}

function textNodesIn(node: globalThis.Node): Text[] {
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
        const text = node as Text;
        return text.data.trim() ? [ text ] : [];
    }

    const nodes: Text[] = [];
    for (const child of node.childNodes) {
        nodes.push(...textNodesIn(child));
    }
    return nodes;
}

function insertionIndex(
    model: Model,
    results: Collection<FindResultType>,
    result: FindResultType
): number {
    return sortFindResults(model, [ ...results, result ]).indexOf(result);
}

type MarkedFindResult = FindResultType & { marker: Marker };

function isWidgetResult(value: MarkedFindResult): boolean {
    return value.marker.name.startsWith("findResult:widget-");
}

const SEARCHABLE_WIDGETS = new Set([ "reference", "linkMention", "linkEmbed" ]);
