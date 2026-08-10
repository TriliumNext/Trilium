import { useEffect, useRef, useState } from "preact/hooks";

import options from "../services/options";
import { useIsNoteReadOnly, useNoteContext } from "./react/hooks";

export default function ScrollPadding() {
    const { note, noteContext, parentComponent, ntxId, viewScope } = useNoteContext();
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number>(10);
    // There is nothing to place the caret at the end of when the note can't be edited. The check is
    // asynchronous, answering `undefined` until it settles; a read-only database is reported as not
    // read-only (there is no editing to switch to), so it has to be ruled out separately.
    const { isReadOnly } = useIsNoteReadOnly(note, noteContext);
    const isEnabled = ["text", "code"].includes(note?.type ?? "")
        && viewScope?.viewMode === "default"
        && note?.isContentAvailable()
        && !note?.isTriliumSqlite()
        && !note?.isMarkdown()
        && !note?.isIconPack()
        && isReadOnly === false
        && !options.is("databaseReadonly");

    const refreshHeight = () => {
        if (!ref.current) return;
        const container = ref.current.closest(".scrolling-container") as HTMLElement | null;
        if (!container) return;
        setHeight(Math.round(container.offsetHeight / 2));
    };

    useEffect(() => {
        if (!isEnabled) return;

        const container = ref.current?.closest(".scrolling-container") as HTMLElement | null;
        if (!container) return;

        // Observe container resize
        const observer = new ResizeObserver(() => refreshHeight());
        observer.observe(container);

        // Initial resize
        refreshHeight();

        return () => observer.disconnect();
    }, [ note, isEnabled ]); // re-run when note changes

    return (isEnabled ?
        <div
            ref={ref}
            className="scroll-padding-widget"
            style={{ height }}
            onClick={() => parentComponent.triggerCommand("scrollToEnd", { ntxId })}
        />
        : <div />
    );
}
