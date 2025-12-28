import "./Collapsible.css";

import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { useElementSize, useUniqueName } from "./hooks";
import Icon from "./Icon";

interface CollapsibleProps extends Pick<HTMLAttributes<HTMLDivElement>, "className"> {
    title: string;
    children: ComponentChildren;
    initiallyExpanded?: boolean;
}

export default function Collapsible({ initiallyExpanded, ...restProps }: CollapsibleProps) {
    const [ expanded, setExpanded ] = useState(initiallyExpanded);
    return <ExternallyControlledCollapsible {...restProps} expanded={expanded} setExpanded={setExpanded} />;
}

export function ExternallyControlledCollapsible({ title, children, className, expanded, setExpanded }: Omit<CollapsibleProps, "initiallyExpanded"> & {
    expanded: boolean | undefined;
    setExpanded: (expanded: boolean) => void
}) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const { height } = useElementSize(innerRef) ?? {};
    const contentId = useUniqueName();
    const [ transitionEnabled, setTransitionEnabled ] = useState(false);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setTransitionEnabled(true);
        }, 200);
        return () => clearTimeout(timeout);
    }, []);

    return (
        <div className={clsx("collapsible", className, {
            expanded,
            "with-transition": transitionEnabled
        })}>
            <button
                className="collapsible-title"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                aria-controls={contentId}
            >
                <Icon className="arrow" icon="bx bx-chevron-right" />&nbsp;
                {title}
            </button>

            <div
                id={contentId}
                ref={bodyRef}
                className="collapsible-body"
                style={{ height: expanded ? height : "0" }}
                aria-hidden={!expanded}
            >
                <div
                    ref={innerRef}
                    className="collapsible-inner-body"
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
