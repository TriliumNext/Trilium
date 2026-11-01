import { ComponentChildren, HTMLAttributes } from "preact";
import { Link } from "./Button.js";
import Icon from "./Icon.js";

import arrowIcon from "../assets/boxicons/bx-chevron-right.svg?raw";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
    title: ComponentChildren;
    imageUrl?: string;
    iconSvg?: string;
    className?: string;
    moreInfoUrl?: string;
    children: ComponentChildren;
}

export default function Card({ title, children, imageUrl, iconSvg, className, moreInfoUrl, ...restProps }: CardProps) {
    return (
        <div className={`card ${moreInfoUrl ? "card-linked" : ""} ${className ?? ""}`} {...restProps}>
            {imageUrl && <img class="image" src={imageUrl} loading="lazy" />}

            <div className="card-content">
                <h3>
                    {moreInfoUrl
                        ? (
                            <Link href={moreInfoUrl} className="card-heading-link" openExternally>
                                {iconSvg && <Icon svg={iconSvg} />}
                                <span>{title}</span>
                                <Icon svg={arrowIcon} className="card-arrow" />
                            </Link>
                        )
                        : (
                            <>
                                {iconSvg && <Icon svg={iconSvg} />}{" "}
                                <span>{title}</span>
                            </>
                        )}
                </h3>

                <div className="card-content-inner">
                    {children}
                </div>
            </div>
        </div>
    )
}
