import { DomEmitterMixin, type ModelElement, Plugin } from "ckeditor5";

import { getDraggedBlocks } from "../block_drag_handle.js";
import BlockReferenceEditing, {
    type AssignBlockReferenceCommand
} from "./block_reference_editing.js";

/**
 * References to blocks of a text note. A right click on the block handle, or a click on the handle
 * of `BlockDragHandle`, calls `blockReference.openHandleMenu()` of the host with the blocks that
 * the handle drags, and the host's menu copies a reference to the selected blocks.
 */
export default class BlockReference extends Plugin {

    private readonly domEmitter = new (DomEmitterMixin())();

    static get pluginName() {
        return "BlockReference" as const;
    }

    static get requires() {
        return [ BlockReferenceEditing ] as const;
    }

    afterInit() {
        const handle = this.getHandleElement();
        if (!handle) {
            return;
        }

        // The editor keeps the focus, so the handle and the selection stay.
        this.domEmitter.listenTo(handle, "mousedown", (_evt, event: MouseEvent) => {
            if (event.button === 2) {
                event.preventDefault();
            }
        });
        this.domEmitter.listenTo(handle, "contextmenu", (_evt, event: MouseEvent) => {
            event.preventDefault();
            this.openMenu(event);
        });
        // The button of `BlockToolbar` opens the toolbar on a click.
        if (this.editor.plugins.has("BlockDragHandle")) {
            this.domEmitter.listenTo(handle, "click", () => this.openMenu(handle));
        }
    }

    override destroy() {
        this.domEmitter.stopListening();
        super.destroy();
    }

    private getHandleElement() {
        const plugins = this.editor.plugins;
        if (plugins.has("BlockDragHandle")) {
            return plugins.get("BlockDragHandle").buttonView?.element;
        }
        if (plugins.has("BlockToolbar")) {
            return plugins.get("BlockToolbar").buttonView.element;
        }

        return null;
    }

    private openMenu(origin: MouseEvent | HTMLElement) {
        const editor = this.editor;
        const command = editor.commands.get("assignBlockReference");
        const openHandleMenu = editor.config.get("blockReference")?.openHandleMenu;
        if (!command?.isEnabled || !openHandleMenu) {
            return;
        }

        const plugins = editor.plugins;
        const dragHandle = plugins.has("BlockDragHandle") ? plugins.get("BlockDragHandle") : null;
        if (dragHandle) {
            dragHandle.isMenuOpen = true;
        }
        openHandleMenu(origin, getDraggedBlocks(editor.model), () => {
            if (dragHandle) {
                dragHandle.isMenuOpen = false;
            }
        });
    }
}

/** What the host of the editor does with references to blocks. */
export interface BlockReferenceHost {
    /**
     * Opens the menu of the block handle for `blocks`, the outermost blocks that the handle drags:
     * at the pointer of `origin` for a right click, or below `origin` for a click on the handle.
     * Calls `onClose` once the menu is closed, or at once if it opens no menu.
     */
    openHandleMenu(
        origin: MouseEvent | HTMLElement, blocks: ModelElement[], onClose: () => void
    ): void;
    /** Copies a reference to the selected blocks. */
    copyReference(): void;
}

declare module "ckeditor5" {
    interface EditorConfig {
        blockReference?: Partial<BlockReferenceHost>;
    }

    interface PluginsMap {
        [BlockReference.pluginName]: BlockReference;
        [BlockReferenceEditing.pluginName]: BlockReferenceEditing;
    }

    interface CommandsMap {
        assignBlockReference: AssignBlockReferenceCommand;
    }
}
