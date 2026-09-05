import { randomUUID } from "node:crypto";

export const PACKAGE_OPERATION_LOCK_NAME = "community-packages";
export const PACKAGE_OPERATION_LOCK_TTL_MS = 5 * 60 * 1000;

interface OperationLock {
    token: string;
    expiresAt: number;
}

interface LockSuccess {
    ok: true;
    token: string;
    expiresAt: number;
}

interface LockFailure {
    ok: false;
    expiresAt: number;
}

const locks = new Map<string, OperationLock>();

function normalizeLockName(name: unknown) {
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
        throw new Error("Invalid operation lock name");
    }
    return name;
}

function removeExpiredLock(name: string, now: number) {
    const lock = locks.get(name);
    if (lock && lock.expiresAt <= now) locks.delete(name);
    return locks.get(name);
}

/**
 * Process-local coordination for operations which must not run concurrently.
 * The lease is deliberately short-lived: a crashed process or tab cannot hold
 * the lock forever, and the caller's transaction recovery handles interruption.
 */
export function acquire(name = PACKAGE_OPERATION_LOCK_NAME, now = Date.now()): LockSuccess | LockFailure {
    const normalizedName = normalizeLockName(name);
    const current = removeExpiredLock(normalizedName, now);
    if (current) return { ok: false, expiresAt: current.expiresAt };

    const lock = { token: randomUUID(), expiresAt: now + PACKAGE_OPERATION_LOCK_TTL_MS };
    locks.set(normalizedName, lock);
    return { ok: true, token: lock.token, expiresAt: lock.expiresAt };
}

export function renew(name: string, token: string, now = Date.now()): LockSuccess | LockFailure {
    const normalizedName = normalizeLockName(name);
    const current = removeExpiredLock(normalizedName, now);
    if (!current || current.token !== token) return { ok: false, expiresAt: current?.expiresAt || 0 };

    current.expiresAt = now + PACKAGE_OPERATION_LOCK_TTL_MS;
    return { ok: true, token: current.token, expiresAt: current.expiresAt };
}

export function release(name: string, token: string, now = Date.now()) {
    const normalizedName = normalizeLockName(name);
    const current = removeExpiredLock(normalizedName, now);
    if (!current || current.token !== token) return false;
    locks.delete(normalizedName);
    return true;
}

/** Test-only reset; production code never needs to clear active leases explicitly. */
export function resetForTests() {
    locks.clear();
}
