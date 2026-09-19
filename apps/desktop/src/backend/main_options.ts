import type { OptionNames } from "@triliumnext/commons";
import { options as optionService } from "@triliumnext/core";

import { MAIN_PROCESS_OPTIONS } from "./protocol_types.js";

/**
 * Reads the handful of options the main process consults synchronously.
 *
 * With the backend in the main process these come from core, as they always
 * have. With the backend in a `utilityProcess`, core is not here to ask: main
 * reads the values once from the database file and then follows the
 * `option-changed` messages the backend pushes, so a `win.on("close")` handler
 * still gets an answer without awaiting anything.
 */
let replica: Record<string, string> | undefined;

/** Whether the backend runs elsewhere, and so core is not available in this process. */
export function isBackendOutOfProcess(): boolean {
    return replica !== undefined;
}

/** Switches main over to the replica. Called only when the backend is out of process. */
export function useOptionReplica(snapshot: Record<string, string>) {
    replica = { ...snapshot };
}

export function applyOptionChange(name: string, value: string) {
    if (replica) {
        replica[name] = value;
    }
}

export function getOption(name: OptionNames): string | undefined {
    if (replica) {
        return replica[name];
    }
    return optionService.getOption(name);
}

/** The option names core will accept for a boolean read. */
type BooleanOptionNames = Parameters<typeof optionService.getOptionBool>[0];

export function getOptionBool(name: BooleanOptionNames): boolean {
    if (replica) {
        return replica[name] === "true";
    }
    return optionService.getOptionBool(name);
}

/**
 * Reads the replica's starting values straight from the database file, before the
 * backend process has opened it. Uses whatever prepared-statement source the
 * caller already has, so nothing here opens a second connection.
 */
export function readOptionSnapshot(read: (name: string) => string | null): Record<string, string> {
    const snapshot: Record<string, string> = {};
    for (const name of MAIN_PROCESS_OPTIONS) {
        const value = read(name);
        if (value !== null) {
            snapshot[name] = value;
        }
    }
    return snapshot;
}
