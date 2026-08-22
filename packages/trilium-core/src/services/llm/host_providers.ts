/**
 * The host-provider registration seam, in a module of its own so hosts can
 * register at startup without loading the LLM stack: `index.js` pulls every
 * SDK-backed provider on import, while this file needs only a type. Keeping
 * registration light is what lets the whole stack stay in lazy chunks until
 * the first chat or MCP request (see the ESM `splitting` in build-utils).
 */

import type { LlmProvider } from "./types.js";

/**
 * Provider types core cannot build for itself, each mapped to the name the user
 * knows it by.
 *
 * What they have in common is a dependency on the runtime around them rather
 * than on an API key: both are CLIs this process spawns, authenticating through
 * the host's own account plumbing rather than a key the user pastes in. Core
 * runs in the browser too, where none of that exists, so the host that *can* do
 * it registers a factory at startup with {@link registerHostProvider}. Where
 * nothing registers one, selecting the provider fails with a message naming it
 * rather than a bare "unknown type".
 *
 * Adding one means an entry here, a literal branch in `createProviderInstance`
 * (see the note there on why it must be literal), and a registration in
 * whichever hosts can serve it.
 */
export const HOST_PROVIDED_TYPES = {
    /** Claude Pro/Max through the Claude Agent SDK, authenticated by `claude /login`. */
    "claude-agent": "Claude Code",
    /** GitHub Copilot through the Copilot CLI's ACP mode, authenticated by `copilot login`. */
    "copilot-agent": "GitHub Copilot"
} as const;

/** A provider type from {@link HOST_PROVIDED_TYPES}. */
export type HostProvidedType = keyof typeof HOST_PROVIDED_TYPES;

/**
 * A factory can resolve asynchronously so the host can dynamically import its
 * provider module inside it — registration then costs nothing at startup.
 */
type HostProviderFactory = () => LlmProvider | Promise<LlmProvider>;

const hostProviderFactories = new Map<string, HostProviderFactory>();

/**
 * Register the host's implementation of a provider core cannot construct.
 * Called once at startup, before any chat can ask for it.
 */
export function registerHostProvider(type: HostProvidedType, factory: HostProviderFactory) {
    hostProviderFactories.set(type, factory);
}

/**
 * Forget every registered factory, putting the registry back to how a build that
 * supplies none starts. For a runtime that re-initialises core (tests, an
 * Electron reload), which registers again on the way back up.
 */
export function clearHostProviders() {
    hostProviderFactories.clear();
}

/**
 * Build a host-provided provider, or explain that this build has no one to build
 * it. The type is always a literal from the call site — see
 * `createProviderInstance` in `index.js` — never the string the user's config
 * carried.
 */
export async function createHostProvider(type: HostProvidedType): Promise<LlmProvider> {
    const factory = hostProviderFactories.get(type);
    if (!factory) {
        throw new Error(`The ${HOST_PROVIDED_TYPES[type]} provider is not available in this build.`);
    }
    return await factory();
}
