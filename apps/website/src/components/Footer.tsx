import "./Footer.css";
import Icon from "./Icon";
import githubIcon from "../assets/boxicons/bx-github.svg?raw";
import githubDiscussionsIcon from "../assets/boxicons/bx-discussion.svg?raw";
import matrixIcon from "../assets/boxicons/bx-message-dots.svg?raw";
import redditIcon from "../assets/boxicons/bx-reddit.svg?raw";
import { Link } from "./Button";

export default function Footer() {
    return (
        <footer>
            <div class="content-wrapper">
                <div class="footer-text">
                    © 2024-2025 <Link href="https://github.com/eliandoran" openExternally>Elian Doran</Link> and the <Link href="https://github.com/TriliumNext/Trilium/graphs/contributors" openExternally>community</Link>.<br />
                    © 2017-2024 <Link href="https://github.com/zadam" openExternally>zadam</Link>.
                </div>

                <SocialButtons />
            </div>
        </footer>
    )
}

export function SocialButtons({ className, withText }: { className?: string, withText?: boolean }) {
    return (
        <div className={`social-buttons ${className}`}>
            <SocialButton
                name="GitHub"
                iconSvg={githubIcon}
                url="https://github.com/TriliumNext/Trilium"
                withText={withText}
            />

            <SocialButton
                name="GitHub Discussions"
                iconSvg={githubDiscussionsIcon}
                url="https://github.com/orgs/TriliumNext/discussions"
                withText={withText}
            />

            <SocialButton
                name="Matrix"
                iconSvg={matrixIcon}
                url="https://matrix.to/#/#triliumnext:matrix.org"
                withText={withText}
            />

            <SocialButton
                name="Reddit"
                iconSvg={redditIcon}
                url="https://www.reddit.com/r/Trilium/"
                withText={withText}
            />
        </div>
    )
}

function SocialButton({ name, iconSvg, url, withText }: { name: string, iconSvg: string, url: string, withText: boolean }) {
    return (
        <Link
            className="social-button"
            href={url} openExternally
            title={!withText ? name : undefined}
        >
            <Icon svg={iconSvg} />
            {withText && name}
        </Link>
    )
}
