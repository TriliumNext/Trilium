import Section from "../../components/Section.js";
import "./SupportUs.css";
import githubIcon from "../../assets/boxicons/bx-github.svg?raw";
import paypalIcon from "../../assets/boxicons/bx-paypal.svg?raw";
import buyMeACoffeeIcon from "../../assets/boxicons/bx-buy-me-a-coffee.svg?raw";
import Button, { Link } from "../../components/Button.js";
import Card from "../../components/Card.js";
import { usePageTitle } from "../../hooks.js";
import { t } from "../../i18n.js";
import { Trans } from "react-i18next";

export default function Donate() {
    usePageTitle(t("support_us.title"));

    return (
        <>
            <Section title={t("support_us.title")} className="donate fill">
                <div class="grid-2-cols">
                    <Card title={t("support_us.financial_donations_title")}>
                        <p>
                            <Trans
                                i18nKey="support_us.financial_donations_description"
                                components={{ Link: <Link href="https://github.com/TriliumNext/Trilium/graphs/commit-activity" openExternally /> }}
                            />
                        </p>

                        <p>
                            <Trans
                                i18nKey="support_us.financial_donations_cta"
                                components={{ Link: <Link href="https://github.com/eliandoran" openExternally /> }}
                            />
                        </p>

                        <ul class="donate-buttons">
                            <li>
                                <Button
                                    iconSvg={githubIcon}
                                    href="https://github.com/sponsors/eliandoran"
                                    text={t("support_us.github_sponsors")}
                                    openExternally
                                />
                            </li>

                            <li>
                                <Button
                                    iconSvg={paypalIcon}
                                    href="https://paypal.me/eliandoran"
                                    text={t("support_us.paypal")}
                                    openExternally
                                    outline
                                />
                            </li>

                            <li>
                                <Button
                                    iconSvg={buyMeACoffeeIcon}
                                    href="https://buymeacoffee.com/eliandoran"
                                    text={t("support_us.buy_me_a_coffee")}
                                    openExternally
                                    outline
                                />
                            </li>
                        </ul>
                    </Card>

                    <Card title={t("contribute.title")}>
                        <ul>
                            <li>
                                <Trans i18nKey="contribute.way_translate"
                                    components={{ Link: <Link href="https://hosted.weblate.org/engage/trilium/" openExternally /> }} />
                            </li>
                            <li>
                                <Trans i18nKey="contribute.way_community"
                                    components={{
                                        Discussions: <Link href="https://github.com/orgs/TriliumNext/discussions" openExternally />,
                                        Matrix: <Link href="https://matrix.to/#/#triliumnext:matrix.org" openExternally />
                                    }}
                                />
                            </li>
                            <li>
                                <Trans i18nKey="contribute.way_reports"
                                    components={{ Link: <Link href="https://github.com/TriliumNext/Trilium/issues" openExternally /> }}
                                />
                            </li>
                            <li><Trans i18nKey="contribute.way_document" /></li>
                            <li><Trans i18nKey="contribute.way_market" /></li>
                        </ul>
                    </Card>
                </div>
            </Section>
        </>
    )
}
