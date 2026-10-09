import type FNote from "@triliumnext/client/src/entities/fnote.js";
import { t } from "@triliumnext/client/src/services/i18n.js";
import { TYPE_MAPPINGS, type TypeWidget } from "@triliumnext/client/src/widgets/note_types.js";
import { useNoteLabel } from "@triliumnext/client/src/widgets/react/hooks.js";
import OverlayControlGroup, {
    OverlayControlButton
} from "@triliumnext/client/src/widgets/react/OverlayControlGroup.js";
import {
    type DisplayMode, resolveDisplayMode
} from "@triliumnext/client/src/widgets/type_widgets/helpers/split_editor_mode.js";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import ShareAppHost, { type AppPayload, setLocalLabel } from "./app_host.js";

/**
 * Mounts the app's own widget for the note's type, read-only, in place of the content the page
 * rendered for visitors without scripts.
 */
export default function mountNoteView(container: HTMLElement, payload: AppPayload) {
    container.replaceChildren();
    render(
        <ShareAppHost noteId={container.dataset.noteId ?? ""} payload={payload}>
            {({ note }) => <NoteView note={note} />}
        </ShareAppHost>,
        container
    );
}

function NoteView({ note }: { note: FNote }) {
    const [ Widget, setWidget ] = useState<TypeWidget>();
    const mapping = TYPE_MAPPINGS[note.type as keyof typeof TYPE_MAPPINGS];

    useEffect(() => {
        Promise.resolve(mapping.view()).then((view) => {
            const widget = "default" in view ? view.default : view;
            setWidget(() => widget);
        });
    }, [ mapping ]);

    return Widget && (
        <div className={mapping.className}>
            <Widget
                note={note}
                viewScope={undefined}
                ntxId={null}
                parentComponent={undefined}
                noteContext={undefined}
                isVisible
            />
            {note.type === "mermaid" && <DisplayModeSwitcher note={note} />}
        </div>
    );
}

/** The app's choice of source, split or preview, which a visitor makes for this page only. */
function DisplayModeSwitcher({ note }: { note: FNote }) {
    const [ displayMode ] = useNoteLabel(note, "displayMode");
    const mode = resolveDisplayMode(displayMode, true);

    return (
        <OverlayControlGroup className="share-display-mode" placement="top-end">
            {DISPLAY_MODES.map(({ value, icon, text }) => (
                <OverlayControlButton
                    key={value}
                    icon={icon}
                    title={t(text)}
                    active={mode === value}
                    onClick={() => setLocalLabel(note.noteId, "displayMode", value)}
                />
            ))}
        </OverlayControlGroup>
    );
}

const DISPLAY_MODES: { value: DisplayMode; icon: string; text: string }[] = [
    { value: "source", icon: "bx bx-code", text: "display_mode.source" },
    { value: "split", icon: "bx bxs-dock-left", text: "display_mode.split" },
    { value: "preview", icon: "bx bx-show", text: "display_mode.preview" }
];
