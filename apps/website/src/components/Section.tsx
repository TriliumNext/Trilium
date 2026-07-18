import { ComponentChildren } from "preact";

import Button from "./Button.js";

interface SectionProps {
    id?: string;
    title?: string;
    subtitle?: string;
    cta?: { text: string; href: string };
    children: ComponentChildren;
    className?: string;
}

export default function Section({ id, className, title, subtitle, cta, children }: SectionProps) {
    return (
        <section id={id} className={className}>
            <div className="content-wrapper">
                {title && <h2>{title}</h2>}
                {subtitle && <p className="section-subtitle">{subtitle}</p>}
                {children}
                {cta && (
                    <div className="section-cta">
                        <Button outline text={cta.text} href={cta.href} openExternally />
                    </div>
                )}
            </div>
        </section>
    )
}
