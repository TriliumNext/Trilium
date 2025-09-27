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
    preserveTreeState?: boolean;
    expandedRowsRef?: RefObject<Set<string>>;
    isDataRefreshingRef?: RefObject<boolean>;
}

export default function Tabulator<T>({ className, columns, data, modules, tabulatorRef: externalTabulatorRef, footerElement, events, index, preserveTreeState, expandedRowsRef, isDataRefreshingRef, ...restProps }: TableProps<T>) {
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

    const treeStateTimeoutRef = useRef<number>();
    
    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (treeStateTimeoutRef.current) {
                clearTimeout(treeStateTimeoutRef.current);
            }
        };
    }, []);
    
    // Change in data - with tree state preservation
    useEffect(() => {
        const tabulator = tabulatorRef.current;
        if (!tabulator || !data) return;

        console.log('Data update triggered, preserveTreeState:', preserveTreeState, 'dataTree option:', tabulator.options?.dataTree);

        if (preserveTreeState && tabulator.options && "dataTree" in tabulator.options && tabulator.options.dataTree && expandedRowsRef) {
            console.log('Tree state preservation using dataTreeStartExpanded approach');
            
            // Clear any existing timeout to prevent overlapping updates
            if (treeStateTimeoutRef.current) {
                clearTimeout(treeStateTimeoutRef.current);
            }
            
            // Simply update data - expansion state will be handled by dataTreeStartExpanded function
            tabulator.setData(data);
        } else {
            tabulator.setData(data);
        }
    }, [ data, preserveTreeState, index ]);
    
    useEffect(() => { columns && tabulatorRef.current?.setColumns(columns)}, [ data]);

    return (
        <div ref={containerRef} className={className} />
    );
}
