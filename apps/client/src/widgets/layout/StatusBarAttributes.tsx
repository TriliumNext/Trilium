import { useContext, useEffect, useMemo, useRef } from "preact/hooks";

import type NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import { ATTRIBUTE_HELP_PAGE } from "../../services/in_app_help";
import AttributeEditor, { type AttributeEditorImperativeHandlers } from "../attribute_widgets/AttributeEditor";
import AttributeHelp from "../attribute_widgets/AttributeHelp";
import InheritedAttributes from "../attribute_widgets/InheritedAttributes";
import { useLegacyImperativeHandlers } from "../react/hooks/legacy";
import { ParentComponent } from "../react/react_utils";
import { BottomPanel, SidebarLink } from "./StatusBarPanels";

/**
 * The attributes panel of the status bar, which edits the note's attributes as a line of text.
 * `StatusBar.tsx` imports this module the first time the panel opens, since the attribute editor is
 * built on CKEditor.
 */
export default function AttributesPane({ note, noteContext, attributesShown, setAttributesShown, initialCommand }: {
    note: FNote;
    noteContext: NoteContext;
    attributesShown: boolean;
    setAttributesShown: (shown: boolean) => void;
    /** The shortcut that opened the panel, which the editor runs once it has mounted. */
    initialCommand?: "addNewLabel" | "addNewRelation";
}) {
    const parentComponent = useContext(ParentComponent);
    const api = useRef<AttributeEditorImperativeHandlers>(null);

    const context = parentComponent && {
        componentId: parentComponent.componentId,
        note,
        hidden: !note
    };

    // Auto-focus the owned attributes.
    useEffect(() => api.current?.focus(), [ attributesShown ]);

    // Interaction with the attribute editor.
    useLegacyImperativeHandlers(useMemo(() => ({
        saveAttributesCommand: () => api.current?.save(),
        reloadAttributesCommand: () => api.current?.refresh(),
        updateAttributeListCommand: ({ attributes }) => api.current?.renderOwnedAttributes(attributes)
    }), [ api ]));

    return (context &&
        <BottomPanel title={t("attributes_panel.title")}
            className="attribute-list"
            visible={attributesShown}
            setVisible={setAttributesShown}
            buttons={<SidebarLink
                text={t("attributes_panel.edit_in_sidebar")}
                tabId="attributes"
                onOpened={() => setAttributesShown(false)}
            />}
            helpPage={ATTRIBUTE_HELP_PAGE}
            helpContent={<AttributeHelp />}>

            <span class="attributes-panel-label">{t("inherited_attribute_list.title")}</span>
            <InheritedAttributes {...context} />

            <AttributeEditor
                {...context}
                api={api}
                notePath={noteContext.notePath}
                ntxId={noteContext.ntxId}
                initialCommand={initialCommand}
            />
        </BottomPanel>
    );
}
