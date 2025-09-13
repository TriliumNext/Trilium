import { useContext, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { EventCallBackMethods, Module, Options, Tabulator as VanillaTabulator } from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.css";
import "../../../../src/stylesheets/table.css";
import { RefObject } from "preact";
import { ParentComponent, renderReactWidget } from "../../react/react_utils";

interface TableProps<T> extends Omit<Options, "data" | "footerElement" | "index"> {
    tabulatorRef: RefObject<VanillaTabulator>;
    className?: string;
    data?: T[];
    modules?: (new (table: VanillaTabulator) => Module)[];
    events?: Partial<EventCallBackMethods>;
    index: keyof T;
}

export default function Tabulator<T>({ className, columns, data, modules, tabulatorRef: externalTabulatorRef, footerElement, events, ...restProps }: TableProps<T>) {
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
            footerElement: (parentComponent && footerElement ? renderReactWidget(parentComponent, footerElement)[0] : undefined),
            ...restProps
        });

        tabulator.on("tableBuilt", () => {
            tabulatorRef.current = tabulator;
            externalTabulatorRef.current = tabulator;
        });

        return () => tabulator.destroy();
    }, []);

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
