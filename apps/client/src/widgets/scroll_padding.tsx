import { useEffect, useRef, useState } from "preact/hooks";
import { useNoteContext } from "./react/hooks";

export default function ScrollPadding() {
    const { note, parentComponent, ntxId, viewScope } = useNoteContext();
    const ref = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState<number>(10);
    const isEnabled = ["text", "code"].includes(note?.type ?? "") && viewScope?.viewMode === "default";

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
        : <div></div>
    )
}
