import "tabulator-tables/dist/css/tabulator.css";
import "../../../../src/stylesheets/table.css";

import { isValidElement, RefObject } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { JSX } from "preact/jsx-runtime";
import { EventCallBackMethods, Module, Options, Tabulator as VanillaTabulator } from "tabulator-tables";

import { ParentComponent, renderReactWidget } from "../../react/react_utils";

export interface TableProps<T extends {}> extends Omit<Options, "data" | "footerElement" | "index"> {
    tabulatorRef?: RefObject<VanillaTabulator>;
    className?: string;
    data?: T[];
    modules?: (new (table: VanillaTabulator) => Module)[];
    events?: Partial<EventCallBackMethods>;
    index?: keyof T;
    footerElement?: string | HTMLElement | JSX.Element;
    onReady?: () => void;
}

export default function Tabulator<T extends {}>({ className, columns, data, modules, tabulatorRef: externalTabulatorRef, footerElement, events, index, dataTree, onReady, ...restProps }: TableProps<T>) {
    const parentComponent = useContext(ParentComponent);
    const containerRef = useRef<HTMLDivElement>(null);
    const tabulatorRef = useRef<VanillaTabulator>(null);
    const pendingDataRef = useRef<T[]>();

    useLayoutEffect(() => {
        if (!modules) return;
        for (const module of modules) {
            VanillaTabulator.registerModule(module);
        }
    }, [modules]);

    useLayoutEffect(() => {
        if (!containerRef.current) return;

        const tabulator = new VanillaTabulator(containerRef.current, {
            columns,
            data,
            footerElement: (parentComponent && isValidElement(footerElement) ? renderReactWidget(parentComponent, footerElement)[0] : undefined),
            index: index as string | number | undefined,
            dataTree,
            ...restProps
        });

        tabulator.on("tableBuilt", () => {
            tabulatorRef.current = tabulator;
            if (externalTabulatorRef) {
                externalTabulatorRef.current = tabulator;
            }
            onReady?.();
        });

        // Deferred, because Tab ends the edit of one cell before the focus event opens the editor
        // of the next one in the same task.
        let flushTimer: ReturnType<typeof setTimeout> | undefined;
        tabulator.on("cellEditCancelled", () => {
            clearTimeout(flushTimer);
            flushTimer = setTimeout(() => {
                if (!pendingDataRef.current || isEditing(tabulator)) return;
                tabulator.replaceData(pendingDataRef.current);
                pendingDataRef.current = undefined;
            }, 0);
        });

        return () => {
            clearTimeout(flushTimer);
            pendingDataRef.current = undefined;
            tabulator.destroy();
        };
    }, [ dataTree ] );

    useEffect(() => {
        const tabulator = tabulatorRef.current;
        if (!tabulator || !events) return;

        for (const [ eventName, handler ] of Object.entries(events)) {
            tabulator.on(eventName as keyof EventCallBackMethods, handler);
        }

        return () => {
            for (const [ eventName, handler ] of Object.entries(events)) {
                tabulator.off(eventName as keyof EventCallBackMethods, handler);
            }
        };
    }, Object.values(events ?? {}));

    // Change in data. replaceData rather than setData: it renders in position instead of
    // resetting the scroll (see resetScroll in Tabulator's RowManager).
    useEffect(() => {
        const tabulator = tabulatorRef.current;
        // replaceData rebuilds every row and cancels the open cell editor, so the rows wait in
        // pendingDataRef until the "cellEditCancelled" handler or the next change applies them.
        if (tabulator && isEditing(tabulator)) {
            pendingDataRef.current = data;
            return;
        }
        pendingDataRef.current = undefined;
        tabulator?.replaceData(data);
    }, [ data ]);
    useEffect(() => {
        if (!columns) return;
        tabulatorRef.current?.setColumns(columns);
    }, [ columns ]);

    return (
        <div ref={containerRef} className={className} />
    );
}

/** Tabulator's EditModule keeps this class on the table element while a cell editor is mounted. */
function isEditing(tabulator: VanillaTabulator) {
    return tabulator.element.classList.contains("tabulator-editing");
}
