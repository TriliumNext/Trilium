import { ComponentChildren } from "preact";

interface SectionProps {
    title?: string;
    children: ComponentChildren;
    className?: string;
}

export default function Section({ className, title, children }: SectionProps) {
    return (
        <section className={className}>
            <div className="content-wrapper">
                {title && <h2>{title}</h2>}
                {children}
            </div>
        </section>
    )
}
