import { ComponentChildren, HTMLAttributes } from "preact";
import { Link } from "./Button";
import Icon from "./Icon";

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
        <div className={`card ${className}`} {...restProps}>
            {imageUrl && <img class="image" src={imageUrl} />}

            <div className="card-content">
                <h3>
                    {iconSvg && <Icon svg={iconSvg} />}{" "}
                    <span>{title}</span>
                </h3>

                <div className="card-content-inner">
                    {children}
                </div>

                {moreInfoUrl && (
                    <div className="more-info-container">
                        <Link href={moreInfoUrl} className="more-info" openExternally>Learn more...</Link>
                    </div>
                )}
            </div>
        </div>
    )
}
