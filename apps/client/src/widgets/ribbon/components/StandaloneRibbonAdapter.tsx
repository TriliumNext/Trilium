import { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { useNoteContext } from "../../react/hooks";
import { shouldShowTab, TabConfiguration, TabContext } from "../ribbon-interface";

interface StandaloneRibbonAdapterProps {
    component: (props: TabContext) => ComponentChildren;
    /** The visibility predicate of the component, normally defined in the ribbon tab configuration. */
    show: TabConfiguration["show"];
}

/**
 * Takes in any ribbon tab component and renders it in standalone mod using the note context, thus requiring no inputs.
 * Especially useful on mobile to detach components that would normally fit in the ribbon.
 */
export default function StandaloneRibbonAdapter({ component, show }: StandaloneRibbonAdapterProps) {
    const Component = component;
    const { note, ntxId, hoistedNoteId, notePath, noteContext, componentId } = useNoteContext();
    const [ shown, setShown ] = useState<boolean | null | undefined>(false);

    useEffect(() => {
        let active = true;
        void shouldShowTab(show, { note, noteContext }).then((result) => {
            // Ignore a stale resolution if the note changed while the predicate was pending.
            if (active) {
                setShown(result);
            }
        });
        return () => {
            active = false;
        };
    }, [ note, noteContext, show ]);

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
