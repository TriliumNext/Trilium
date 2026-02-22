import "./Card.css";
import { ComponentChildren, createContext } from "preact";
import { JSX, HTMLAttributes } from "preact";
import { useContext } from "preact/hooks";
import clsx from "clsx";

// #region Card Frame

export interface CardFrameProps extends HTMLAttributes<HTMLDivElement> {
    className?: string;
    highlightOnHover?: boolean;
    children: ComponentChildren;
}

export function CardFrame({className, highlightOnHover, children, ...rest}: CardFrameProps) {
    return <div {...rest}
                className={clsx("tn-card-frame", className, {
                    "tn-card-highlight-on-hover": highlightOnHover
                })}>

        {children}
    </div>;
}

// #endregion

// #region Card

export interface CardProps {
    className?: string;
    heading?: string;
}

export function Card(props: {children: ComponentChildren} & CardProps) {
    return <div className={clsx("tn-card", props.className)}>
        {props.heading && <h5 class="tn-card-heading">{props.heading}</h5>}
        <div className="tn-card-body">
            {props.children}
        </div>
    </div>;
}

// #endregion

// #region Card Section

export interface CardSectionProps {
    className?: string;
    subSections?: JSX.Element | JSX.Element[];
    subSectionsVisible?: boolean;
    highlightOnHover?: boolean;
    onAction?: () => void;
}

interface CardSectionContextType {
    nestingLevel: number;
}

const CardSectionContext = createContext<CardSectionContextType | undefined>(undefined);

export function CardSection(props: {children: ComponentChildren} & CardSectionProps) {
    const parentContext = useContext(CardSectionContext);
    const nestingLevel = (parentContext && parentContext.nestingLevel + 1) ?? 0;

    return <>
        <section className={clsx("tn-card-section", props.className, {
                    "tn-card-section-nested": nestingLevel > 0,
                    "tn-card-highlight-on-hover": props.highlightOnHover || props.onAction
                 })}
                 style={{"--tn-card-section-nesting-level": (nestingLevel) ? nestingLevel : null}}
                 onClick={props.onAction}>
            {props.children}
        </section>

        {props.subSectionsVisible && props.subSections &&
            <CardSectionContext.Provider value={{nestingLevel}}>
                {props.subSections}
            </CardSectionContext.Provider>
        }
    </>;
}

// #endregion