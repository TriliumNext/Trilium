import clsx from "clsx";
import { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

interface FluidWrapperParams {
    className?: string;
    breakpoints: {[key: string]: number};
    children: ComponentChildren;
}

export function FluidWrapper({className, breakpoints, children}: FluidWrapperParams) {
    const ref = useRef<HTMLDivElement>(null);
    const sortedBreakpoints = useMemo(() => {
        return Object.entries(breakpoints).sort(([, a], [, b]) => a - b)
    }, [breakpoints]);
    const [activeBreakpoint, setActiveBreakpoint] = useState<string | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const onWidthChanged = (width: number) => {
            let match = sortedBreakpoints[0]?.[0] ?? null;
            for (const [name, min] of sortedBreakpoints) {
                if (width >= min) match = name;
                else break;
            }
            setActiveBreakpoint(match);
        };

        const observer = new ResizeObserver(([entry]) => onWidthChanged(entry.contentRect.width));
        observer.observe(el);
        onWidthChanged(el.getBoundingClientRect().width);

        return () => observer.disconnect();
    }, [sortedBreakpoints]);

    return <div ref={ref} className="fluid-container">
        <div className={clsx(className, activeBreakpoint)}>
            {children}
        </div>
    </div>
}