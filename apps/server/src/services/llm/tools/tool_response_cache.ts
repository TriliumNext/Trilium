/**
 * Tool Response Cache
 * 
 * Implements LRU cache with TTL for deterministic/read-only tool responses,
 * with cache key generation, invalidation strategies, and hit rate tracking.
 */

import log from '../../log.js';
import crypto from 'crypto';

/**
 * Cache entry with metadata
 */
interface CacheEntry<T = any> {
    key: string;
    value: T;
    timestamp: Date;
    expiresAt: Date;
    hits: number;
    size: number;
    toolName: string;
    provider?: string;
}

/**
 * Cache statistics
 */
export interface CacheStatistics {
    totalEntries: number;
    totalSize: number;
    hitRate: number;
    missRate: number;
    evictionCount: number;
    avgHitsPerEntry: number;
    oldestEntry?: Date;
    newestEntry?: Date;
    topTools: Array<{ tool: string; hits: number }>;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
    /** Maximum cache size in bytes (default: 50MB) */
    maxSize: number;
    /** Maximum number of entries (default: 1000) */
    maxEntries: number;
    /** Default TTL in milliseconds (default: 300000 - 5 minutes) */
    defaultTTL: number;
    /** Enable automatic cleanup (default: true) */
    autoCleanup: boolean;
    /** Cleanup interval in milliseconds (default: 60000) */
    cleanupInterval: number;
    /** Enable hit tracking (default: true) */
    trackHits: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CacheConfig = {
    maxSize: 50 * 1024 * 1024,    // 50MB
    maxEntries: 1000,
    defaultTTL: 300000,            // 5 minutes
    autoCleanup: true,
    cleanupInterval: 60000,        // 1 minute
    trackHits: true
};

/**
 * Tool-specific TTL overrides (in milliseconds)
 */
const TOOL_TTL_OVERRIDES: Record<string, number> = {
    // Static data tools - longer TTL
    'read_note_tool': 600000,      // 10 minutes
    'get_note_metadata': 600000,   // 10 minutes
    
    // Search tools - medium TTL
    'search_notes_tool': 300000,   // 5 minutes
    'keyword_search_tool': 300000, // 5 minutes
    
    // Dynamic data tools - shorter TTL
    'get_recent_notes': 60000,     // 1 minute
    'get_workspace_status': 30000  // 30 seconds
};

/**
 * Deterministic tools that can be cached
 */
const CACHEABLE_TOOLS = new Set([
    'read_note_tool',
    'search_notes_tool',
    'keyword_search_tool',
    'attribute_search_tool',
    'get_note_metadata',
    'get_note_content',
    'get_recent_notes',
    'get_workspace_status',
    'list_notes',
    'find_notes_by_tag'
]);

/**
 * Tool response cache class
 */
export class ToolResponseCache {
    private config: CacheConfig;
    private cache: Map<string, CacheEntry>;
    private accessOrder: string[];
    private totalHits: number;
    private totalMisses: number;
    private evictionCount: number;
    private cleanupTimer?: NodeJS.Timeout;
    private currentSize: number;

    constructor(config?: Partial<CacheConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.cache = new Map();
        this.accessOrder = [];
        this.totalHits = 0;
        this.totalMisses = 0;
        this.evictionCount = 0;
        this.currentSize = 0;
        
        if (this.config.autoCleanup) {
            this.startAutoCleanup();
        }
    }

    /**
     * Check if a tool is cacheable
     */
    isCacheable(toolName: string): boolean {
        return CACHEABLE_TOOLS.has(toolName);
    }

    /**
     * Generate cache key for tool call
     */
    generateCacheKey(
        toolName: string,
        args: Record<string, any>,
        provider?: string
    ): string {
        // Sort arguments for consistent key generation
        const sortedArgs = this.sortObjectDeep(args);
        
        // Create key components
        const keyComponents = {
            tool: toolName,
            args: sortedArgs,
            provider: provider || 'default'
        };
        
        // Generate hash
        const hash = crypto
            .createHash('sha256')
            .update(JSON.stringify(keyComponents))
            .digest('hex');
        
        return `${toolName}:${hash.substring(0, 16)}`;
    }

    /**
     * Get cached response
     */
    get(
        toolName: string,
        args: Record<string, any>,
        provider?: string
    ): any | undefined {
        if (!this.isCacheable(toolName)) {
            return undefined;
        }
        
        const key = this.generateCacheKey(toolName, args, provider);
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.totalMisses++;
            log.info(`Cache miss for ${toolName}`);
            return undefined;
        }
        
        // Check if expired
        if (new Date() > entry.expiresAt) {
            this.cache.delete(key);
            this.removeFromAccessOrder(key);
            this.currentSize -= entry.size;
            this.totalMisses++;
            log.info(`Cache expired for ${toolName}`);
            return undefined;
        }
        
        // Update hit count and access order
        if (this.config.trackHits) {
            entry.hits++;
            this.updateAccessOrder(key);
        }
        
        this.totalHits++;
        log.info(`Cache hit for ${toolName} (${entry.hits} hits)`);
        
        return entry.value;
    }

    /**
     * Set cached response
     */
    set(
        toolName: string,
        args: Record<string, any>,
        value: any,
        provider?: string,
        ttl?: number
    ): boolean {
        if (!this.isCacheable(toolName)) {
            return false;
        }
        
        const key = this.generateCacheKey(toolName, args, provider);
        const size = this.calculateSize(value);
        
        // Check size limits
        if (size > this.config.maxSize) {
            log.info(`Cache entry too large for ${toolName}: ${size} bytes`);
            return false;
        }
        
        // Evict entries if necessary
        while (this.cache.size >= this.config.maxEntries || 
               this.currentSize + size > this.config.maxSize) {
            this.evictLRU();
        }
        
        // Determine TTL
        const effectiveTTL = ttl || 
                           TOOL_TTL_OVERRIDES[toolName] || 
                           this.config.defaultTTL;
        
        // Create entry
        const entry: CacheEntry = {
            key,
            value,
            timestamp: new Date(),
            expiresAt: new Date(Date.now() + effectiveTTL),
            hits: 0,
            size,
            toolName,
            provider
        };
        
        // Add to cache
        this.cache.set(key, entry);
        this.accessOrder.push(key);
        this.currentSize += size;
        
        log.info(`Cached response for ${toolName} (${size} bytes, TTL: ${effectiveTTL}ms)`);
        
        return true;
    }

    /**
     * Invalidate cache entries
     */
    invalidate(filter?: {
        toolName?: string;
        provider?: string;
        pattern?: RegExp;
    }): number {
        let invalidated = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            let shouldInvalidate = false;
            
            if (filter?.toolName && entry.toolName === filter.toolName) {
                shouldInvalidate = true;
            }
            if (filter?.provider && entry.provider === filter.provider) {
                shouldInvalidate = true;
            }
            if (filter?.pattern && filter.pattern.test(key)) {
                shouldInvalidate = true;
            }
            if (!filter) {
                shouldInvalidate = true; // Invalidate all if no filter
            }
            
            if (shouldInvalidate) {
                this.cache.delete(key);
                this.removeFromAccessOrder(key);
                this.currentSize -= entry.size;
                invalidated++;
            }
        }
        
        log.info(`Invalidated ${invalidated} cache entries`);
        return invalidated;
    }

    /**
     * Evict least recently used entry
     */
    private evictLRU(): void {
        if (this.accessOrder.length === 0) return;
        
        const key = this.accessOrder.shift()!;
        const entry = this.cache.get(key);
        
        if (entry) {
            this.cache.delete(key);
            this.currentSize -= entry.size;
            this.evictionCount++;
            log.info(`Evicted cache entry for ${entry.toolName} (LRU)`);
        }
    }

    /**
     * Update access order for LRU
     */
    private updateAccessOrder(key: string): void {
        this.removeFromAccessOrder(key);
        this.accessOrder.push(key);
    }

    /**
     * Remove from access order
     */
    private removeFromAccessOrder(key: string): void {
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
        }
    }

    /**
     * Calculate size of value in bytes
     */
    private calculateSize(value: any): number {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        return Buffer.byteLength(str, 'utf8');
    }

    /**
     * Sort object deeply for consistent key generation
     */
    private sortObjectDeep(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sortObjectDeep(item));
        }
        
        const sorted: any = {};
        const keys = Object.keys(obj).sort();
        
        for (const key of keys) {
            sorted[key] = this.sortObjectDeep(obj[key]);
        }
        
        return sorted;
    }

    /**
     * Start automatic cleanup
     */
    private startAutoCleanup(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupInterval);
    }

    /**
     * Stop automatic cleanup
     */
    private stopAutoCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }

    /**
     * Clean up expired entries
     */
    cleanup(): number {
        const now = new Date();
        let cleaned = 0;
        
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                this.removeFromAccessOrder(key);
                this.currentSize -= entry.size;
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            log.info(`Cleaned up ${cleaned} expired cache entries`);
        }
        
        return cleaned;
    }

    /**
     * Get cache statistics
     */
    getStatistics(): CacheStatistics {
        const entries = Array.from(this.cache.values());
        const totalRequests = this.totalHits + this.totalMisses;
        
        // Calculate tool hit counts
        const toolHits = new Map<string, number>();
        for (const entry of entries) {
            const current = toolHits.get(entry.toolName) || 0;
            toolHits.set(entry.toolName, current + entry.hits);
        }
        
        // Sort tools by hits
        const topTools = Array.from(toolHits.entries())
            .map(([tool, hits]) => ({ tool, hits }))
            .sort((a, b) => b.hits - a.hits)
            .slice(0, 10);
        
        // Find oldest and newest entries
        const timestamps = entries.map(e => e.timestamp);
        const oldestEntry = timestamps.length > 0 
            ? new Date(Math.min(...timestamps.map(t => t.getTime())))
            : undefined;
        const newestEntry = timestamps.length > 0
            ? new Date(Math.max(...timestamps.map(t => t.getTime())))
            : undefined;
        
        // Calculate average hits
        const totalHitsInCache = entries.reduce((sum, e) => sum + e.hits, 0);
        const avgHitsPerEntry = entries.length > 0 
            ? totalHitsInCache / entries.length 
            : 0;
        
        return {
            totalEntries: this.cache.size,
            totalSize: this.currentSize,
            hitRate: totalRequests > 0 ? this.totalHits / totalRequests : 0,
            missRate: totalRequests > 0 ? this.totalMisses / totalRequests : 0,
            evictionCount: this.evictionCount,
            avgHitsPerEntry,
            oldestEntry,
            newestEntry,
            topTools
        };
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
        this.accessOrder = [];
        this.currentSize = 0;
        this.totalHits = 0;
        this.totalMisses = 0;
        this.evictionCount = 0;
        log.info('Cleared entire cache');
    }

    /**
     * Get cache size info
     */
    getSizeInfo(): {
        entries: number;
        bytes: number;
        maxEntries: number;
        maxBytes: number;
        utilizationPercent: number;
    } {
        return {
            entries: this.cache.size,
            bytes: this.currentSize,
            maxEntries: this.config.maxEntries,
            maxBytes: this.config.maxSize,
            utilizationPercent: (this.currentSize / this.config.maxSize) * 100
        };
    }

    /**
     * Export cache contents
     */
    exportCache(): string {
        const data = {
            config: this.config,
            entries: Array.from(this.cache.entries()),
            statistics: this.getStatistics(),
            metadata: {
                exportedAt: new Date(),
                version: '1.0.0'
            }
        };
        
        return JSON.stringify(data, null, 2);
    }

    /**
     * Import cache contents
     */
    importCache(json: string): void {
        try {
            const data = JSON.parse(json);
            
            // Clear existing cache
            this.clear();
            
            // Import entries
            for (const [key, entry] of data.entries) {
                // Convert dates
                entry.timestamp = new Date(entry.timestamp);
                entry.expiresAt = new Date(entry.expiresAt);
                
                // Skip expired entries
                if (new Date() > entry.expiresAt) continue;
                
                this.cache.set(key, entry);
                this.accessOrder.push(key);
                this.currentSize += entry.size;
            }
            
            log.info(`Imported ${this.cache.size} cache entries`);
        } catch (error) {
            log.error(`Failed to import cache: ${error}`);
            throw error;
        }
    }

    /**
     * Shutdown cache
     */
    shutdown(): void {
        this.stopAutoCleanup();
        this.clear();
        log.info('Cache shutdown complete');
    }
}

// Export singleton instance
export const toolResponseCache = new ToolResponseCache();