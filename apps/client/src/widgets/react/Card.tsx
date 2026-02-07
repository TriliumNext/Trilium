import type { ComponentChildren } from "preact";

export function Card({ title, children }: { title: string, children: ComponentChildren }) {
    return (
        <div className="card">
            <div className="card-body">
                <h5 className="card-title">{title}</h5>

                <p className="card-text">
                    {children}
                </p>
            </div>
        </div>
    );
}
