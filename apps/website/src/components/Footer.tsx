import "./Footer.css";
import Icon from "./Icon.js";
import githubIcon from "../assets/boxicons/bx-github.svg?raw";
import githubDiscussionsIcon from "../assets/boxicons/bx-discussion.svg?raw";
import matrixIcon from "../assets/boxicons/bx-message-dots.svg?raw";
import redditIcon from "../assets/boxicons/bx-reddit.svg?raw";
import { Link } from "./Button.js";
import { t } from "../i18n";

export default function Footer() {
    return (
        <footer>
            <div class="content-wrapper">
                <div class="footer-text">
                    © 2024-2025 <Link href="https://github.com/eliandoran" openExternally>Elian Doran</Link>{t("footer.copyright_and_the")}<Link href="https://github.com/TriliumNext/Trilium/graphs/contributors" openExternally>{t("footer.copyright_community")}</Link>.<br />
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
                name={t("social_buttons.github")}
                iconSvg={githubIcon}
                url="https://github.com/TriliumNext/Trilium"
                withText={withText}
            />

            <SocialButton
                name={t("social_buttons.github_discussions")}
                iconSvg={githubDiscussionsIcon}
                url="https://github.com/orgs/TriliumNext/discussions"
                withText={withText}
            />

            <SocialButton
                name={t("social_buttons.matrix")}
                iconSvg={matrixIcon}
                url="https://matrix.to/#/#triliumnext:matrix.org"
                withText={withText}
            />

            <SocialButton
                name={t("social_buttons.reddit")}
                iconSvg={redditIcon}
                url="https://www.reddit.com/r/Trilium/"
                withText={withText}
            />
        </div>
    )
}

export function SocialButton({ name, iconSvg, url, withText, counter }: { name: string, iconSvg: string, url: string, withText?: boolean, counter?: string | undefined }) {
    return (
        <Link
            className="social-button"
            href={url} openExternally
            title={!withText ? name : undefined}
        >
            <Icon svg={iconSvg} />
            {counter && <span class="counter">{counter}</span>}
            {withText && name}
        </Link>
    )
}

