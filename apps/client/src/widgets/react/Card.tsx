import clsx from "clsx";
import type { ComponentChildren } from "preact";

export function Card({ title, className, children }: {
    title: string;
    children: ComponentChildren;
    className?: string;
}) {
    return (
        <div className={clsx("card", className)}>
            <div className="card-body">
                <h5 className="card-title">{title}</h5>

                <p className="card-text">
                    {children}
                </p>
            </div>
        </div>
    );
}
