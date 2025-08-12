/**
 * Virtual Scrolling Component
 * 
 * Provides efficient rendering of large lists by only rendering visible items.
 * Optimized for the tool execution history display.
 */

export interface VirtualScrollOptions {
    container: HTMLElement;
    itemHeight: number;
    totalItems: number;
    renderBuffer?: number;
    overscan?: number;
    onRenderItem: (index: number) => HTMLElement;
    onScrollEnd?: () => void;
}

export interface VirtualScrollItem {
    index: number;
    element: HTMLElement;
    top: number;
}

/**
 * Virtual Scroll Manager
 */
export class VirtualScrollManager {
    private container: HTMLElement;
    private viewport: HTMLElement;
    private content: HTMLElement;
    private itemHeight: number;
    private totalItems: number;
    private renderBuffer: number;
    private overscan: number;
    private onRenderItem: (index: number) => HTMLElement;
    private onScrollEnd?: () => void;
    
    private visibleItems: Map<number, VirtualScrollItem> = new Map();
    private scrollRAF?: number;
    private lastScrollTop: number = 0;
    private scrollEndTimeout?: number;
    
    // Performance optimization constants
    private static readonly DEFAULT_RENDER_BUFFER = 3;
    private static readonly DEFAULT_OVERSCAN = 2;
    private static readonly SCROLL_END_DELAY = 150;
    private static readonly RECYCLE_POOL_SIZE = 50;
    
    // Element recycling pool
    private recyclePool: HTMLElement[] = [];

    constructor(options: VirtualScrollOptions) {
        this.container = options.container;
        this.itemHeight = options.itemHeight;
        this.totalItems = options.totalItems;
        this.renderBuffer = options.renderBuffer ?? VirtualScrollManager.DEFAULT_RENDER_BUFFER;
        this.overscan = options.overscan ?? VirtualScrollManager.DEFAULT_OVERSCAN;
        this.onRenderItem = options.onRenderItem;
        this.onScrollEnd = options.onScrollEnd;
        
        this.setupStructure();
        this.attachListeners();
        this.render();
    }

    /**
     * Setup DOM structure for virtual scrolling
     */
    private setupStructure(): void {
        // Create viewport (scrollable container)
        this.viewport = document.createElement('div');
        this.viewport.className = 'virtual-scroll-viewport';
        this.viewport.style.cssText = `
            height: 100%;
            overflow-y: auto;
            position: relative;
        `;
        
        // Create content (holds actual items)
        this.content = document.createElement('div');
        this.content.className = 'virtual-scroll-content';
        this.content.style.cssText = `
            position: relative;
            height: ${this.totalItems * this.itemHeight}px;
        `;
        
        this.viewport.appendChild(this.content);
        this.container.appendChild(this.viewport);
    }

    /**
     * Attach scroll listeners
     */
    private attachListeners(): void {
        this.viewport.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
        
        // Use ResizeObserver for dynamic container size changes
        if (typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(() => {
                this.render();
            });
            resizeObserver.observe(this.viewport);
        }
    }

    /**
     * Handle scroll events with requestAnimationFrame
     */
    private handleScroll(): void {
        if (this.scrollRAF) {
            cancelAnimationFrame(this.scrollRAF);
        }
        
        this.scrollRAF = requestAnimationFrame(() => {
            this.render();
            this.detectScrollEnd();
        });
    }

    /**
     * Detect when scrolling has ended
     */
    private detectScrollEnd(): void {
        const scrollTop = this.viewport.scrollTop;
        
        if (this.scrollEndTimeout) {
            clearTimeout(this.scrollEndTimeout);
        }
        
        this.scrollEndTimeout = window.setTimeout(() => {
            if (scrollTop === this.lastScrollTop) {
                this.onScrollEnd?.();
            }
            this.lastScrollTop = scrollTop;
        }, VirtualScrollManager.SCROLL_END_DELAY);
    }

    /**
     * Render visible items
     */
    private render(): void {
        const scrollTop = this.viewport.scrollTop;
        const viewportHeight = this.viewport.clientHeight;
        
        // Calculate visible range with overscan
        const startIndex = Math.max(0, 
            Math.floor(scrollTop / this.itemHeight) - this.overscan
        );
        const endIndex = Math.min(this.totalItems - 1,
            Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + this.overscan
        );
        
        // Remove items that are no longer visible
        this.removeInvisibleItems(startIndex, endIndex);
        
        // Add new visible items
        for (let i = startIndex; i <= endIndex; i++) {
            if (!this.visibleItems.has(i)) {
                this.addItem(i);
            }
        }
    }

    /**
     * Remove items outside visible range
     */
    private removeInvisibleItems(startIndex: number, endIndex: number): void {
        const itemsToRemove: number[] = [];
        
        this.visibleItems.forEach((item, index) => {
            if (index < startIndex - this.renderBuffer || index > endIndex + this.renderBuffer) {
                itemsToRemove.push(index);
            }
        });
        
        itemsToRemove.forEach(index => {
            const item = this.visibleItems.get(index);
            if (item) {
                this.recycleElement(item.element);
                this.visibleItems.delete(index);
            }
        });
    }

    /**
     * Add a single item to the visible list
     */
    private addItem(index: number): void {
        const element = this.getOrCreateElement(index);
        const top = index * this.itemHeight;
        
        element.style.cssText = `
            position: absolute;
            top: ${top}px;
            left: 0;
            right: 0;
            height: ${this.itemHeight}px;
        `;
        
        this.content.appendChild(element);
        
        this.visibleItems.set(index, {
            index,
            element,
            top
        });
    }

    /**
     * Get or create an element (with recycling)
     */
    private getOrCreateElement(index: number): HTMLElement {
        let element = this.recyclePool.pop();
        
        if (element) {
            // Clear previous content
            element.innerHTML = '';
            element.className = '';
        } else {
            element = document.createElement('div');
        }
        
        // Render new content
        const content = this.onRenderItem(index);
        if (content !== element) {
            element.appendChild(content);
        }
        
        return element;
    }

    /**
     * Recycle an element for reuse
     */
    private recycleElement(element: HTMLElement): void {
        element.remove();
        
        if (this.recyclePool.length < VirtualScrollManager.RECYCLE_POOL_SIZE) {
            this.recyclePool.push(element);
        }
    }

    /**
     * Update total items and re-render
     */
    public updateTotalItems(totalItems: number): void {
        this.totalItems = totalItems;
        this.content.style.height = `${totalItems * this.itemHeight}px`;
        this.render();
    }

    /**
     * Scroll to a specific index
     */
    public scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth'): void {
        const top = index * this.itemHeight;
        this.viewport.scrollTo({
            top,
            behavior
        });
    }

    /**
     * Get current scroll position
     */
    public getScrollPosition(): { index: number; offset: number } {
        const scrollTop = this.viewport.scrollTop;
        const index = Math.floor(scrollTop / this.itemHeight);
        const offset = scrollTop % this.itemHeight;
        
        return { index, offset };
    }

    /**
     * Refresh visible items
     */
    public refresh(): void {
        this.visibleItems.forEach(item => {
            item.element.remove();
        });
        this.visibleItems.clear();
        this.render();
    }

    /**
     * Destroy the virtual scroll manager
     */
    public destroy(): void {
        if (this.scrollRAF) {
            cancelAnimationFrame(this.scrollRAF);
        }
        
        if (this.scrollEndTimeout) {
            clearTimeout(this.scrollEndTimeout);
        }
        
        this.visibleItems.forEach(item => {
            item.element.remove();
        });
        
        this.visibleItems.clear();
        this.recyclePool = [];
        this.viewport.remove();
    }
}

/**
 * Create a virtual scroll instance
 */
export function createVirtualScroll(options: VirtualScrollOptions): VirtualScrollManager {
    return new VirtualScrollManager(options);
}