import { CSSProperties } from "preact/compat";

/**
 * Handles the editing toolbar when the CKEditor is in decoupled mode.
 *
 * This toolbar is only enabled if the user has selected the classic CKEditor.
 *
 * The ribbon item is active by default for text notes, as long as they are not in read-only mode.
 */
export default function FormattingTab({ hidden }) {
    const style: CSSProperties = {};
    if (hidden) {
        style.display = "none";
    }

    return (
        <div className="classic-toolbar-widget" style={style}>

        </div>
    )
};