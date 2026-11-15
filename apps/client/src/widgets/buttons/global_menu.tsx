import "./global_menu.css";

import { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import utils, { isStandalone } from "../../services/utils";
import Dropdown from "../react/Dropdown";
import { useTriliumOptionBool } from "../react/hooks/options";
import { useStaticTooltip } from "../react/hooks/tooltip";
import { preloadLazyModule, useLazyModule } from "../react/LazyComponent";

export default function GlobalMenu({ isHorizontalLayout }: { isHorizontalLayout: boolean }) {
    const isVerticalLayout = !isHorizontalLayout;
    const { isUpdateAvailable, latestVersion } = useTriliumUpdateStatus();
    const logoRef = useRef<SVGSVGElement>(null);
    useStaticTooltip(logoRef);

    return (
        <Dropdown
            className="global-menu"
            buttonClassName={`global-menu-button ${isHorizontalLayout ? "bx bx-menu" : ""}`} noSelectButtonStyle iconAction hideToggleArrow
            text={<>
                {isVerticalLayout && <VerticalLayoutIcon logoRef={logoRef} />}
                {isUpdateAvailable && <div class="global-menu-button-update-available">
                    <span className="bx bxs-down-arrow-alt global-menu-button-update-available-button" title={t("update_available.update_available")} />
                </div>}
            </>}
            mobileBackdrop
            buttonProps={PRELOAD_ITEMS_PROPS}
        >
            <LazyGlobalMenuItems isUpdateAvailable={isUpdateAvailable} latestVersion={latestVersion} />
        </Dropdown>
    );
}

// The rows load once the menu is about to open.
const loadGlobalMenuItems = () => import("./GlobalMenuItems");
const PRELOAD_ITEMS_PROPS = {
    onPointerEnter: () => preloadLazyModule(loadGlobalMenuItems),
    onFocus: () => preloadLazyModule(loadGlobalMenuItems)
};

function LazyGlobalMenuItems(props: { isUpdateAvailable: boolean, latestVersion: string | undefined }) {
    const globalMenuItems = useLazyModule(loadGlobalMenuItems);
    return globalMenuItems && <globalMenuItems.default {...props} />;
}

function VerticalLayoutIcon({ logoRef }: { logoRef?: RefObject<SVGSVGElement | null> }) {
    return (
        <svg ref={logoRef} viewBox="0 0 256 256" title={t("global_menu.menu")}>
            <g>
                <path className="st0" d="m202.9 112.7c-22.5 16.1-54.5 12.8-74.9 6.3l14.8-11.8 14.1-11.3 49.1-39.3-51.2 35.9-14.3 10-14.9 10.5c0.7-21.2 7-49.9 28.6-65.4 1.8-1.3 3.9-2.6 6.1-3.8 2.7-1.5 5.7-2.9 8.8-4.1 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.9 65.9-2.4 2.8-4.9 5.4-7.4 7.8-3.4 3.5-6.8 6.4-10.1 8.8z"/>
                <path className="st1" d="m213.1 104c-22.2 12.6-51.4 9.3-70.3 3.2l14.1-11.3 49.1-39.3-51.2 35.9-14.3 10c0.5-18.1 4.9-42.1 19.7-58.6 2.7-1.5 5.7-2.9 8.8-4.1 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.9 65.9-2.3 2.8-4.8 5.4-7.2 7.8z"/>
                <path className="st2" d="m220.5 96.2c-21.1 8.6-46.6 5.3-63.7-0.2l49.2-39.4-51.2 35.9c0.3-15.8 3.5-36.6 14.3-52.8 27.1-11.1 68.5-15.3 85.2-9.5 0.1 16.2-15.9 45.4-33.8 66z"/>

                <path className="st3" d="m106.7 179c-5.8-21 5.2-43.8 15.5-57.2l4.8 14.2 4.5 13.4 15.9 47-12.8-47.6-3.6-13.2-3.7-13.9c15.5 6.2 35.1 18.6 40.7 38.8 0.5 1.7 0.9 3.6 1.2 5.5 0.4 2.4 0.6 5 0.7 7.7 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8-1.4-2.6-2.7-5.1-3.8-7.6-1.6-3.5-2.9-6.8-3.8-10z"/>
                <path className="st4" d="m110.4 188.9c-3.4-19.8 6.9-40.5 16.6-52.9l4.5 13.4 15.9 47-12.8-47.6-3.6-13.2c13.3 5.2 29.9 15 38.1 30.4 0.4 2.4 0.6 5 0.7 7.7 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8-1.4-2.6-2.7-5.2-3.8-7.7z"/>
                <path className="st5" d="m114.2 196.5c-0.7-18 8.6-35.9 17.3-47.1l15.9 47-12.8-47.6c11.6 4.4 26.1 12.4 35.2 24.8 0.9 23.1-7.1 54.9-15.9 65.7-12-4.3-29.3-24-39.7-42.8z"/>

                <path className="st6" d="m86.3 59.1c21.7 10.9 32.4 36.6 35.8 54.9l-15.2-6.6-14.5-6.3-50.6-22 48.8 24.9 13.6 6.9 14.3 7.3c-16.6 7.9-41.3 14.5-62.1 4.1-1.8-0.9-3.6-1.9-5.4-3.2-2.3-1.5-4.5-3.2-6.8-5.1-19.9-16.4-40.3-46.4-42.7-61.5 12.4-6.5 41.5-5.8 64.8-0.3 3.2 0.8 6.2 1.6 9.1 2.5 4 1.3 7.6 2.8 10.9 4.4z"/>
                <path className="st7" d="m75.4 54.8c18.9 12 28.4 35.6 31.6 52.6l-14.5-6.3-50.6-22 48.7 24.9 13.6 6.9c-14.1 6.8-34.5 13-53.3 8.2-2.3-1.5-4.5-3.2-6.8-5.1-19.8-16.4-40.2-46.4-42.6-61.5 12.4-6.5 41.5-5.8 64.8-0.3 3.1 0.8 6.2 1.6 9.1 2.6z"/>
                <path className="st8" d="m66.3 52.2c15.3 12.8 23.3 33.6 26.1 48.9l-50.6-22 48.8 24.9c-12.2 6-29.6 11.8-46.5 10-19.8-16.4-40.2-46.4-42.6-61.5 12.4-6.5 41.5-5.8 64.8-0.3z"/>
            </g>
        </svg>
    );
}

/** GitHub's "latest release" endpoint, which already excludes drafts and pre-releases. */
export const RELEASES_API_URL = "https://api.github.com/repos/TriliumNext/Trilium/releases/latest";

/** How often to re-check for a newer release, in milliseconds. */
export const UPDATE_CHECK_INTERVAL = 8 * 60 * 60 * 1000;

/** The `localStorage` key of the last successful check, which reloads and other windows reuse. */
const LAST_CHECK_KEY = "trilium-update-check";

interface LastCheck {
    checkedAt: number;
    latestVersion?: string;
}

/**
 * Watches GitHub for a release newer than the version this client is running, so the menu can show
 * the update badge and a download link. A check younger than {@link UPDATE_CHECK_INTERVAL} is reused
 * from `localStorage`, so a reload or another window sends no request to GitHub.
 *
 * Standalone is left out: it is served from the web and picks up new versions on reload, so there is
 * no release for the user to go and download. Every other client — desktop and server alike — is
 * updated by hand and wants the hint.
 */
export function useTriliumUpdateStatus() {
    const [ checkForUpdates ] = useTriliumOptionBool("checkForUpdates");
    const [ latestVersion, setLatestVersion ] = useState<string | undefined>(() => (checkForUpdates && !isStandalone
        ? readLastCheck()?.latestVersion
        : undefined));
    const isUpdateAvailable = utils.isUpdateAvailable(latestVersion, window.glob.triliumVersion);

    useEffect(() => {
        if (!checkForUpdates || isStandalone) {
            setLatestVersion(undefined);
            return;
        }

        // A request still in flight when the option is switched off (or the menu unmounts) must not
        // resurrect the version afterwards, so ignore whatever it resolves to.
        let cancelled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        async function updateVersionStatus() {
            let latestVersion: string | undefined;
            try {
                const resp = await fetch(RELEASES_API_URL);
                const data = await resp.json();
                latestVersion = parseLatestVersion(data);
                writeLastCheck({ checkedAt: Date.now(), latestVersion });
            } catch (e) {
                console.warn("Unable to fetch latest version info from GitHub releases API", e);
            }

            if (!cancelled) {
                setLatestVersion(latestVersion);
                timeout = setTimeout(() => void updateVersionStatus(), UPDATE_CHECK_INTERVAL);
            }
        }

        const lastCheck = readLastCheck();
        const age = lastCheck ? Date.now() - lastCheck.checkedAt : Infinity;
        if (lastCheck && age >= 0 && age < UPDATE_CHECK_INTERVAL) {
            setLatestVersion(lastCheck.latestVersion);
            timeout = setTimeout(() => void updateVersionStatus(), UPDATE_CHECK_INTERVAL - age);
        } else {
            void updateVersionStatus();
        }

        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [ checkForUpdates ]);

    return { isUpdateAvailable, latestVersion };
}

/** Reads the version off a GitHub release payload, stripping the tag prefix (`v0.104.1` → `0.104.1`). */
export function parseLatestVersion(payload: unknown): string | undefined {
    const tagName = (payload as { tag_name?: unknown } | null | undefined)?.tag_name;
    return typeof tagName === "string" ? tagName.replace(/^v/, "") : undefined;
}

function readLastCheck(): LastCheck | undefined {
    try {
        const parsed = JSON.parse(localStorage.getItem(LAST_CHECK_KEY) ?? "null") as Partial<LastCheck> | null;
        if (typeof parsed?.checkedAt !== "number") return undefined;
        return {
            checkedAt: parsed.checkedAt,
            latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : undefined
        };
    } catch {
        return undefined;
    }
}

function writeLastCheck(check: LastCheck) {
    try {
        localStorage.setItem(LAST_CHECK_KEY, JSON.stringify(check));
    } catch {
        // Without storage, the next reload checks again.
    }
}
