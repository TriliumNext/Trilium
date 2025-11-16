import { ComponentChildren } from "preact";
import { useNoteContext } from "../../react/hooks";
import { TabContext } from "../ribbon-interface";
import { useEffect, useMemo, useState } from "preact/hooks";
import { RIBBON_TAB_DEFINITIONS } from "../RibbonDefinition";
import { shouldShowTab } from "../Ribbon";

interface StandaloneRibbonAdapterProps {
    component: (props: TabContext) => ComponentChildren;
}

/**
 * Takes in any ribbon tab component and renders it in standalone mod using the note context, thus requiring no inputs.
 * Especially useful on mobile to detach components that would normally fit in the ribbon.
 */
export default function StandaloneRibbonAdapter({ component }: StandaloneRibbonAdapterProps) {
    const Component = component;
    const { note, ntxId, hoistedNoteId, notePath, noteContext, componentId } = useNoteContext();
    const definition = useMemo(() => RIBBON_TAB_DEFINITIONS.find(def => def.content === component), [ component ]);
    const [ shown, setShown ] = useState<boolean | null | undefined>(false);

    useEffect(() => {
        if (!definition) return;
        shouldShowTab(definition.show, { note, noteContext }).then(setShown);
    }, [ note ]);

    return (
        <Component
            note={note}
            hidden={!shown}
            ntxId={ntxId}
            hoistedNoteId={hoistedNoteId}
            notePath={notePath}
            noteContext={noteContext}
            componentId={componentId}
            activate={() => {}}
        />
    );
}
