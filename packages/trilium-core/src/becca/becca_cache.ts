import Becca from "./becca-interface.js";
import { getLog } from "../services/log.js";

interface CacheEntry {
    becca: Becca;
    lastAccess: number;
}

const IDLE_TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, CacheEntry>();

export function getCachedBecca(userId: string): Becca | null {
    const entry = cache.get(userId);
    if (!entry) return null;
    entry.lastAccess = Date.now();
    return entry.becca;
}

export function setCachedBecca(userId: string, userBecca: Becca): void {
    cache.set(userId, { becca: userBecca, lastAccess: Date.now() });
}

export function evictUser(userId: string): void {
    cache.delete(userId);
    getLog().info(`becca_cache: evicted user ${userId}`);
}

export function evictIdle(): void {
    const threshold = Date.now() - IDLE_TTL_MS;
    for (const [userId, entry] of cache) {
        if (entry.lastAccess < threshold) {
            getLog().info(`becca_cache: evicting idle Becca for user ${userId}`);
            cache.delete(userId);
        }
    }
}

export function clearAll(): void {
    cache.clear();
}
