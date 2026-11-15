/**
 * Drives the startup splash screen that index.html renders inline, before any script or
 * stylesheet is fetched. Status strings are English-only, as in the standalone error overlay:
 * the splash runs while the backend that serves the translation catalogues is still starting,
 * so `initLocale()` has neither a locale nor an `assetPath` to fetch one with.
 *
 * Imports no client module: index.ts loads it before setupGlob() populates window.glob, which most
 * client modules read at module scope.
 */

import "./splash.css";

import logoUrl from "../assets/icon-color.svg?url";

/** Matches the `#splash` opacity transition in index.html. */
const SPLASH_FADE_MS = 150;

/**
 * How full the bar can get while the startup is still running. The last phase would otherwise
 * ease to a full bar and sit there, which reads as finished; {@link hideSplash} closes the gap.
 */
const MAX_RUNNING_FILL = 0.95;

/** One step of the startup sequence, which the progress bar advances through. */
export interface SplashPhase {
    /** Name {@link reportSplashPhase} uses to announce that the step has started. */
    id: string;
    /** Relative cost of the step, which sets how much of the bar it covers. */
    weight: number;
    /** Shown under the bar while the step runs. */
    status: string;
}

let phases: SplashPhase[] = [];
let totalWeight = 0;

/** Index of the phase now running. */
let currentPhase = -1;

/**
 * Hands the progress bar the sequence it is to track, replacing its indeterminate animation.
 * Standalone's `main.ts` calls it with `STANDALONE_STARTUP_PHASES`.
 */
export function initSplashProgress(startupPhases: SplashPhase[]): void {
    if (!startupPhases.length) {
        return;
    }
    phases = startupPhases;
    totalWeight = phases.reduce((sum, phase) => sum + phase.weight, 0);

    const bar = document.querySelector("#splash .splash-bar");
    if (!bar) {
        return;
    }

    // The indeterminate fill sits at 40% of the bar, which is further along than most startups
    // begin. Dropping to the real starting position has to skip the long ease, or the bar spends
    // its first seconds visibly shrinking; the guard is lifted a frame later, once 0 has landed.
    bar.classList.add("is-continuous", "is-starting");
    requestAnimationFrame(() => bar.classList.remove("is-starting"));
}

/**
 * Advances the bar to the named phase and shows its status. Never moves backwards, so a phase
 * that is reported late — or, in a follower tab, not at all — cannot undo the progress shown.
 */
export function reportSplashPhase(id: string): void {
    const index = phases.findIndex((phase) => phase.id === id);
    const phase = phases[index];
    if (!phase || index <= currentPhase) {
        return;
    }
    currentPhase = index;

    // The bar eases towards the end of the phase now running rather than sitting at its start, so
    // a step that takes seconds still shows movement; the long ease-out in index.html means it
    // only approaches that end, and never claims more than the running phase covers.
    const completed = phases.slice(0, index).reduce((sum, earlier) => sum + earlier.weight, 0);
    setFillWidth(Math.min((completed + phase.weight) / totalWeight, MAX_RUNNING_FILL));

    updateSplashStatus(phase.status);
}

/** Replaces the status line under the progress bar. */
export function updateSplashStatus(status: string): void {
    const statusEl = document.getElementById("splash-status");
    if (statusEl) {
        statusEl.textContent = status;
    }
}

/**
 * Switches the splash to its error state: the progress bar goes away and the message shows. A
 * page without a splash gets a screen of its own with the logo, the app's name and the message.
 */
export function showSplashError(message: string): void {
    const splashEl = document.getElementById("splash");
    if (!splashEl || splashEl.classList.contains("splash-hidden")) {
        document.body.append(buildStartupError(message));
        return;
    }
    splashEl.classList.add("splash-error");
    updateSplashStatus(message);
}

/**
 * Logs a failure to start and shows it with {@link showSplashError}. An entry point that starts the
 * app after its first render calls it as well, as the page's `bootstrap()` has finished by then.
 */
export function showStartupFailure(err: unknown): void {
    console.error("Trilium failed to start:", err);
    const message = err instanceof Error ? err.message : String(err);
    showSplashError(`Trilium failed to start: ${message} — reload the page to try again.`);
}

/** Fades the splash out and removes it, revealing the application behind it. */
export function hideSplash(): void {
    const splashEl = document.getElementById("splash");
    if (!splashEl) {
        return;
    }

    // Run the bar out to full, so the last phase is not left mid-flight behind the fade.
    splashEl.querySelector(".splash-bar")?.classList.add("is-finishing");
    setFillWidth(1);

    splashEl.classList.add("splash-hidden");
    setTimeout(() => splashEl.remove(), SPLASH_FADE_MS);
}

function buildStartupError(message: string) {
    const screenEl = document.createElement("div");
    screenEl.id = "startup-error";
    screenEl.setAttribute("role", "alert");

    const logoEl = document.createElement("img");
    logoEl.className = "startup-error-logo";
    logoEl.src = logoUrl;
    logoEl.alt = "";

    const titleEl = document.createElement("div");
    titleEl.className = "startup-error-title";
    titleEl.textContent = "Trilium Notes";

    const messageEl = document.createElement("p");
    messageEl.className = "startup-error-message";
    messageEl.textContent = message;

    screenEl.append(logoEl, titleEl, messageEl);
    return screenEl;
}

function setFillWidth(fraction: number): void {
    const fill = document.querySelector<HTMLElement>("#splash .splash-bar-fill");
    if (fill) {
        // The one genuinely computed value here: how far through the startup the bar has got.
        fill.style.width = `${Math.min(100, Math.round(fraction * 100))}%`;
    }
}
