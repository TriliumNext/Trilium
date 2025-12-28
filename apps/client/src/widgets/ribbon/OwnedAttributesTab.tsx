import { useMemo, useRef } from "preact/hooks";

import { useLegacyImperativeHandlers, useTriliumEvents } from "../react/hooks";
import AttributeEditor, { AttributeEditorImperativeHandlers } from "./components/AttributeEditor";
import { TabContext } from "./ribbon-interface";

export default function OwnedAttributesTab({ note, hidden, activate, ntxId, ...restProps }: TabContext) {
    const api = useRef<AttributeEditorImperativeHandlers>(null);

    useTriliumEvents([ "addNewLabel", "addNewRelation" ], ({ ntxId: eventNtxId }) => {
        if (ntxId === eventNtxId) {
            activate();
        }
    });

    // Interaction with the attribute editor.
    useLegacyImperativeHandlers(useMemo(() => ({
        saveAttributesCommand: () => api.current?.save(),
        reloadAttributesCommand: () => api.current?.refresh(),
        updateAttributeListCommand: ({ attributes }) => api.current?.renderOwnedAttributes(attributes)
    }), [ api ]));

    return (
        <div className="attribute-list">
            { note && (
                <AttributeEditor api={api} ntxId={ntxId} note={note} {...restProps} hidden={hidden} />
            )}
        </div>
    );
}
