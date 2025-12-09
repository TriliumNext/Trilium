import "./Footer.css";
import Icon from "./Icon.js";
import githubIcon from "../assets/boxicons/bx-github.svg?raw";
import githubDiscussionsIcon from "../assets/boxicons/bx-discussion.svg?raw";
import matrixIcon from "../assets/boxicons/bx-message-dots.svg?raw";
import redditIcon from "../assets/boxicons/bx-reddit.svg?raw";
import { Link } from "./Button.js";
import { LOCALES, swapLocaleInUrl } from "../i18n";
import { useTranslation } from "react-i18next";
import { useLocation } from "preact-iso";
import { useContext } from "preact/hooks";
import { LocaleContext } from "..";

export default function Footer() {
    const { t } = useTranslation();
    const { url } = useLocation();
    const currentLocale = useContext(LocaleContext);

    return (
        <footer>
            <div class="content-wrapper">
                <div class="row">
                    <div class="footer-text">
                        © 2024-2025 <Link href="https://github.com/eliandoran" openExternally>Elian Doran</Link>{t("footer.copyright_and_the")}<Link href="https://github.com/TriliumNext/Trilium/graphs/contributors" openExternally>{t("footer.copyright_community")}</Link>.<br />
                        © 2017-2024 <Link href="https://github.com/zadam" openExternally>zadam</Link>.
                    </div>

                    <SocialButtons />
                </div>

                <div class="row">
                    <nav class="languages">
                        {LOCALES.map(locale => (
                            locale.id !== currentLocale
                            ? <Link href={swapLocaleInUrl(url, locale.id)}>{locale.name}</Link>
                            : <span className="active">{locale.name}</span>
                        ))}
                    </nav>
                </div>
            </div>
        </footer>
    )
}

export function SocialButtons({ className, withText }: { className?: string, withText?: boolean }) {
    const { t } = useTranslation();

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

