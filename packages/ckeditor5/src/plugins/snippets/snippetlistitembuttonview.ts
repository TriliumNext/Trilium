import { ButtonView, HighlightedTextView, type Locale, View } from "ckeditor5";

import type { SnippetDefinition } from "./snippetsconfig.js";

/**
 * A single row in the snippet dropdown list: a wide button showing the snippet's icon, its title and
 * (optionally) its description. Both the title and description can be highlighted to reflect the
 * current search query.
 *
 * The note icon is rendered as a plain font-icon `<span>` (see {@link NoteIconView}) rather than fed
 * through CKEditor's SVG-only `IconView` — Trilium owns this plugin, so the old SVG `<foreignObject>`
 * wrapper around a Boxicon is no longer needed.
 */
export default class SnippetListItemButtonView extends ButtonView {

    public readonly definition: SnippetDefinition;

    private noteIconView: NoteIconView | null = null;
    private textPartView: SnippetTextPartView | null = null;

    constructor(locale: Locale | undefined, definition: SnippetDefinition) {
        super(locale);

        this.definition = definition;

        this.set({
            withText: true,
            class: "ck-template-button",
            role: "option"
        });
    }

    public override render(): void {
        super.render();

        // `labelView` is always rendered by `super.render()` above, so its element (and id) exist.
        const labelElement = this.labelView.element as HTMLElement;
        this.noteIconView = new NoteIconView(this.locale, this.definition);
        this.textPartView = new SnippetTextPartView(this.locale, this.definition, labelElement.id);

        // Replace the plain label with a note-icon + (title + description) block.
        this.children.remove(this.labelView);
        this.children.add(this.noteIconView);
        this.children.add(this.textPartView);
    }

    /**
     * Returns whether the snippet matches the given search expression (by title or description),
     * or `null` when it does not match at all.
     */
    public isMatching(regExp: RegExp): { title: boolean; description: boolean } | null {
        const { title, description } = this.definition;
        const titleMatches = !!title.match(regExp);
        const descriptionMatches = !!description?.match(regExp);

        return titleMatches || descriptionMatches
            ? { title: titleMatches, description: descriptionMatches }
            : null;
    }

    public highlightText(regExp: RegExp | null): void {
        this.textPartView?.highlightText(regExp);
    }

    public override destroy(): void {
        super.destroy();
        this.labelView.destroy();
    }
}

/**
 * A note's font icon (`tn-icon bx bx-…`), rendered as a `<span>`. The colour class from the note's
 * `#color` label, when present, is applied alongside so the icon keeps its note colour.
 */
class NoteIconView extends View {

    constructor(locale: Locale | undefined, definition: SnippetDefinition) {
        super(locale);

        this.setTemplate({
            tag: "span",
            attributes: {
                class: ["ck-template-icon", definition.iconClass, definition.iconColorClass].filter(Boolean)
            }
        });
    }
}

/**
 * The title + optional description block placed inside a {@link SnippetListItemButtonView}.
 */
class SnippetTextPartView extends View {

    private readonly titleView: HighlightedTextView;
    private readonly descriptionView: HighlightedTextView | null;

    constructor(locale: Locale | undefined, definition: SnippetDefinition, labelId?: string) {
        super(locale);

        this.titleView = new HighlightedTextView();
        this.titleView.text = definition.title;
        this.titleView.extendTemplate({
            tag: "span",
            attributes: {
                class: ["ck-button__label"],
                id: labelId
            }
        });

        const children: View[] = [this.titleView];

        if (definition.description) {
            this.descriptionView = new HighlightedTextView();
            this.descriptionView.text = definition.description;
            this.descriptionView.extendTemplate({
                tag: "p",
                attributes: {
                    class: ["ck-template-form__description"]
                }
            });
            children.push(this.descriptionView);
        } else {
            this.descriptionView = null;
        }

        this.setTemplate({
            tag: "div",
            attributes: {
                class: ["ck", "ck-template-form__text-part"]
            },
            children
        });
    }

    public highlightText(regExp: RegExp | null): void {
        this.titleView.highlightText(regExp);
        this.descriptionView?.highlightText(regExp);
    }
}
