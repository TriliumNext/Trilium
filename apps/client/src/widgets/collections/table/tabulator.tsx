import { useContext, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { EventCallBackMethods, Module, Options, Tabulator as VanillaTabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.css";
import "../../../../src/stylesheets/table.css";
import { ParentComponent, renderReactWidget } from "../../react/react_utils";
import { JSX } from "preact/jsx-runtime";
import { isValidElement, RefObject } from "preact";

interface TableProps<T> extends Omit<Options, "data" | "footerElement" | "index"> {
    tabulatorRef: RefObject<VanillaTabulator>;
    className?: string;
    data?: T[];
    modules?: (new (table: VanillaTabulator) => Module)[];
    events?: Partial<EventCallBackMethods>;
    index: keyof T;
    footerElement?: string | HTMLElement | JSX.Element;
    onReady?: () => void;
}

export default function Tabulator<T>({ className, columns, data, modules, tabulatorRef: externalTabulatorRef, footerElement, events, index, dataTree, onReady, ...restProps }: TableProps<T>) {
    const parentComponent = useContext(ParentComponent);
    const containerRef = useRef<HTMLDivElement>(null);
    const tabulatorRef = useRef<VanillaTabulator>(null);

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
            externalTabulatorRef.current = tabulator;
            onReady?.();
        });

        return () => tabulator.destroy();
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
        }
    }, Object.values(events ?? {}));

    // Change in data.
    useEffect(() => { tabulatorRef.current?.setData(data) }, [ data ]);
    useEffect(() => { columns && tabulatorRef.current?.setColumns(columns)}, [ data]);

    return (
        <div ref={containerRef} className={className} />
    );
}
