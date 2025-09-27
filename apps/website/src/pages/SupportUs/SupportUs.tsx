import Section from "../../components/Section";
import "./SupportUs.css";
import githubIcon from "../../assets/boxicons/bx-github.svg?raw";
import paypalIcon from "../../assets/boxicons/bx-paypal.svg?raw";
import buyMeACoffeeIcon from "../../assets/boxicons/bx-buy-me-a-coffee.svg?raw";
import Button, { Link } from "../../components/Button";
import Card from "../../components/Card";
import { usePageTitle } from "../../hooks";

export default function Donate() {
    usePageTitle("Support us");

    return (
        <>
            <Section title="Support us" className="donate fill">
                <div class="grid-2-cols">
                    <Card title="Financial donations">
                        <p>
                            Trilium is built and maintained with <Link href="https://github.com/TriliumNext/Trilium/graphs/commit-activity" openExternally>hundreds of hours of work</Link>.
                            Your support keeps it open-source, improves features, and covers costs such as hosting.
                        </p>

                        <p>Consider supporting the main developer (<Link href="https://github.com/eliandoran" openExternally>eliandoran</Link>) of the application via:</p>

                        <ul class="donate-buttons">
                            <li>
                                <Button
                                    iconSvg={githubIcon}
                                    href="https://github.com/sponsors/eliandoran"
                                    text="GitHub Sponsors"
                                    openExternally
                                />
                            </li>

                            <li>
                                <Button
                                    iconSvg={paypalIcon}
                                    href="https://paypal.me/eliandoran"
                                    text="PayPal"
                                    openExternally
                                    outline
                                />
                            </li>

                            <li>
                                <Button
                                    iconSvg={buyMeACoffeeIcon}
                                    href="https://buymeacoffee.com/eliandoran"
                                    text="Buy Me A Coffee"
                                    openExternally
                                    outline
                                />
                            </li>
                        </ul>
                    </Card>

                    <Card title="Other ways to contribute">
                        <ul>
                            <li>Translate the application into your native language via <Link href="https://hosted.weblate.org/engage/trilium/" openExternally>Weblate</Link>.</li>
                            <li>Interact with the community on <Link href="https://github.com/orgs/TriliumNext/discussions" openExternally>GitHub Discussions</Link> or on <Link href="https://matrix.to/#/#triliumnext:matrix.org" openExternally>Matrix</Link>.</li>
                            <li>Report bugs via <Link href="https://github.com/TriliumNext/Trilium/issues" openExternally>GitHub issues</Link>.</li>
                            <li>Improve the documentation by informing us on gaps in the documentation or contributing guides, FAQs or tutorials.</li>
                            <li>Spread the word: Share Trilium Notes with friends, or on blogs and social media.</li>
                        </ul>
                    </Card>
                </div>
            </Section>
        </>
    )
}
