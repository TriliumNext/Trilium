import {
    _sortFindResultsByMarkerPositions as sortFindResults,
    Collection,
    FindAndReplaceEditing,
    FindAndReplaceUtils,
    Plugin,
    uid,
    type CommandExecuteEvent,
    type FindAttributes,
    type FindResultType,
    type Marker,
    type Model,
    type ModelElement
} from "ckeditor5";

/** Adds search results for rendered link text that is not stored as CKEditor model text. */
export default class FindInLinkWidgets extends Plugin {

    static get requires() {
        return [ FindAndReplaceEditing ] as const;
    }

    static get pluginName() {
        return "FindInLinkWidgets" as const;
    }

    afterInit() {
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
        const findByText = editor.plugins
            .get(FindAndReplaceUtils)
            .findByTextCallback(query, options ?? {});

        for (const root of model.document.getRoots()) {
            for (const item of model.createRangeIn(root).getItems()) {
                // One marker identifies one atomic widget, so repeated matches remain one result.
                const isMatch = item.is("element") && visibleText(editor, item).some(
                    (text) => findByText({ item, text }).length > 0
                );
                if (!isMatch) {
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

function visibleText(editor: FindInLinkWidgets["editor"], element: ModelElement): string[] {
    if (!SEARCHABLE_WIDGETS.has(element.name)) {
        return [];
    }

    const viewElement = editor.editing.mapper.toViewElement(element);
    if (!viewElement) {
        return [];
    }

    const domElement = editor.editing.view.domConverter.mapViewToDom(viewElement);
    if (!domElement) {
        return [];
    }

    return textNodesIn(domElement);
}

function textNodesIn(node: globalThis.Node): string[] {
    const texts: string[] = [];
    if (node.nodeType === globalThis.Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        return text ? [ text ] : [];
    }

    for (const child of node.childNodes) {
        texts.push(...textNodesIn(child));
    }
    return texts;
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
