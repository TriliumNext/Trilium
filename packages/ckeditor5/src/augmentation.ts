import "ckeditor5";

declare global {
    interface LinkEmbedMetadata {
        url: string;
        embedType: string;
        title?: string;
        description?: string;
        favicon?: string;
        siteName?: string;
        image?: string;
        /**
         * True when the host could not read the page (network error, bot challenge, non-HTML
         * response, or a page with no title of its own) and the fields above hold nothing but a
         * hostname-derived placeholder. Mirrors `LinkEmbedMetadata.unresolved` in
         * `@triliumnext/commons`, which is what the host actually returns.
         */
        unresolved?: boolean;
    }

    /** A button that the content of an embed adds to the toolbar of the embed. */
    interface ContentEmbedTool {
        id: string;
        /** The name of what the button does, shown as its tooltip. */
        label: string;
        /** The text of a button without an icon. */
        text?: string;
        /** The SVG of the icon of the button. */
        icon?: string;
        /** Whether a button that toggles is on. A command leaves it out. */
        isOn?: boolean;
        /** `true` when left out. */
        isEnabled?: boolean;
        /** A separator goes between buttons, or items of a menu, of different groups. */
        group?: string;
        /**
         * The keystroke shown beside the label of an item of a menu: CKEditor's notation, such as
         * `Ctrl+F`, or a single character, such as `?`.
         */
        keystroke?: string;
        /** The tools of the menu that the button opens. */
        children?: ContentEmbedTool[];
        /**
         * Whether the button opens a menu that the content draws, with
         * `ContentEmbedToolProvider.openMenu()`, instead of running the tool.
         */
        opensMenu?: boolean;
        /** A class of the button, for the content to style it. */
        class?: string;
    }

    /** An item of the embed toolbar that the content of an embed can hide. */
    type ContentEmbedToolbarItem =
        "contentEmbedBoxSizeDropdown" | "toggleContentEmbedTitle" | "convertEmbedToLink"
        | "toggleContentEmbedEditable";

    /** The buttons that the content of an embed, such as a canvas drawing, adds to its toolbar. */
    interface ContentEmbedToolProvider {
        getTools(): ContentEmbedTool[];
        execute(id: string): void;
        /** Opens the menu of the tool `id`, which sets `opensMenu`, below `anchor`. */
        openMenu?(id: string, anchor: HTMLElement): void;
        /** Calls `callback` when `getTools()` changes, until the returned function is called. */
        subscribe(callback: () => void): () => void;
        /** The items of the embed toolbar to hide. The menu of the embed still offers them. */
        hiddenToolbarItems?: readonly ContentEmbedToolbarItem[];
        /**
         * An SVG icon that the box size dropdown of the embed toolbar shows in place of the name of
         * the box size, which its tooltip then names.
         */
        boxSizeIcon?: string;
        /**
         * Whether the content has an editable mode, which the toolbar and the menu of the embed
         * then turn on and off. The embed carries `data-editable="true"` while it is on.
         */
        hasEditableFlag?: boolean;
        /**
         * Whether the content shows its source, its rendering or both, which the toolbar and the
         * menu of the embed then switch. The embed carries the mode as `data-display-mode`.
         */
        hasDisplayModes?: boolean;
    }
}

