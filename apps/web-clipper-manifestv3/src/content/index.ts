import { Logger, MessageUtils } from '@/shared/utils';
import { ClipData, ImageData } from '@/shared/types';
import { HTMLSanitizer } from '@/shared/html-sanitizer';
import { DuplicateDialog } from './duplicate-dialog';
import { DateFormatter } from '@/shared/date-formatter';
import { extractArticle } from '@/shared/article-extraction';
import type { ArticleExtractionResult } from '@/shared/article-extraction';

const logger = Logger.create('Content', 'content');

/**
 * Content script for the Trilium Web Clipper extension
 * Handles page content extraction and user interactions
 */
class ContentScript {
  private static instance: ContentScript | null = null;
  private isInitialized = false;
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private lastPingTime: number = 0;

  constructor() {
    // Enhanced idempotency check
    if (ContentScript.instance) {
      logger.debug('Content script instance already exists, reusing...', {
        isInitialized: ContentScript.instance.isInitialized,
        connectionState: ContentScript.instance.connectionState
      });

      // If already initialized, we're good
      if (ContentScript.instance.isInitialized) {
        return ContentScript.instance;
      }

      // If not initialized, continue initialization
      logger.warn('Found uninitialized instance, completing initialization');
    }

    ContentScript.instance = this;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug('Content script already initialized');
      return;
    }

    try {
      logger.info('Initializing content script...');

      this.setConnectionState('connecting');

      this.setupMessageHandler();

      this.isInitialized = true;
      this.setConnectionState('connected');
      logger.info('Content script initialized successfully');

      // Announce readiness to background script
      this.announceReady();
    } catch (error) {
      this.setConnectionState('disconnected');
      logger.error('Failed to initialize content script', error as Error);
    }
  }

  private setConnectionState(state: 'disconnected' | 'connecting' | 'connected'): void {
    this.connectionState = state;
    logger.debug('Connection state changed', { state });
  }

  private announceReady(): void {
    // Let the background script know we're ready
    // This allows the background to track which tabs have loaded content scripts
    chrome.runtime.sendMessage({
      type: 'CONTENT_SCRIPT_READY',
      url: window.location.href,
      timestamp: Date.now()
    }).catch(() => {
      // Background might not be listening yet, that's OK
      // The declarative injection ensures we're available anyway
      logger.debug('Could not announce ready to background (background may not be active)');
    });
  }  private setupMessageHandler(): void {
    // Remove any existing listeners first
    if (chrome.runtime.onMessage.hasListeners()) {
      chrome.runtime.onMessage.removeListener(this.handleMessage.bind(this));
    }

    chrome.runtime.onMessage.addListener(
      MessageUtils.createResponseHandler(this.handleMessage.bind(this))
    );

    logger.debug('Message handler setup complete');
  }

  private async handleMessage(message: any): Promise<unknown> {
    logger.debug('Received message', { type: message.type, message });

    try {
      switch (message.type) {
        case 'PING':
          // Simple health check - content script is ready if we can respond
          this.lastPingTime = Date.now();
          return {
            success: true,
            timestamp: this.lastPingTime
          };

        case 'GET_SELECTION':
          return this.getSelection();

        case 'GET_PAGE_CONTENT':
          return this.getPageContent();

        case 'GET_SCREENSHOT_AREA':
          return this.getScreenshotArea();

        case 'SHOW_TOAST':
          return this.showToast(message.message, message.variant, message.duration);

        case 'SHOW_DUPLICATE_DIALOG':
          return this.showDuplicateDialog(message.existingNoteId, message.url);

        default:
          logger.warn('Unknown message type', { message });
          return { success: false, error: 'Unknown message type' };
      }
    } catch (error) {
      logger.error('Error handling message', error as Error, { message });
      return { success: false, error: (error as Error).message };
    }
  }

  private async showDuplicateDialog(existingNoteId: string, url: string): Promise<{ action: 'append' | 'new' | 'cancel' }> {
    logger.info('Showing duplicate dialog', { existingNoteId, url });

    const dialog = new DuplicateDialog();
    return await dialog.show(existingNoteId, url);
  }

  private async getSelection(): Promise<ClipData> {
    logger.debug('Getting selection...');

    const selection = window.getSelection();
    if (!selection || selection.toString().trim() === '') {
      throw new Error('No text selected');
    }

    const range = selection.getRangeAt(0);
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());

    // Process embedded media in selection
    this.processEmbeddedMedia(container);

    // Process images and make URLs absolute
    const images = await this.processImages(container);
    this.makeLinksAbsolute(container);

    return {
      title: this.generateTitle('Selection'),
      content: container.innerHTML,
      url: window.location.href,
      images,
      type: 'selection'
    };
  }

  private async getPageContent(): Promise<ClipData> {
    logger.debug('Getting page content...');

    try {
      // ============================================================
      // 3-PHASE CLIENT-SIDE PROCESSING ARCHITECTURE
      // ============================================================
      // Phase 1 (Content Script): Readability - Extract article from real DOM
      // Phase 2 (Content Script): DOMPurify - Sanitize extracted HTML
      // Phase 3 (Background Script): Cheerio - Final cleanup & processing
      // ============================================================
      // This approach follows the MV2 extension pattern but adapted for MV3:
      // - Phases 1 & 2 happen in content script (need real DOM)
      // - Phase 3 happens in background script (no DOM needed)
      // - Proper MV3 message passing between phases
      // ============================================================

      logger.info('Phase 1: Running article extraction with code block preservation...');

      // ============================================================
      // CODE BLOCK PRESERVATION SYSTEM
      // ============================================================
      // The article extraction module intelligently determines whether to
      // apply code block preservation based on:
      // - User settings (enabled/disabled globally)
      // - Site allow list (specific domains/URLs)
      // - Auto-detection (presence of code blocks)
      // ============================================================

      // Capture pre-extraction stats for logging
      const preExtractionStats = {
        totalElements: document.body.querySelectorAll('*').length,
        scripts: document.body.querySelectorAll('script').length,
        styles: document.body.querySelectorAll('style, link[rel="stylesheet"]').length,
        images: document.body.querySelectorAll('img').length,
        links: document.body.querySelectorAll('a').length,
        bodyLength: document.body.innerHTML.length
      };

      logger.debug('Pre-extraction DOM stats', preExtractionStats);

      // Extract article using centralized extraction module
      // This will automatically handle code block preservation based on settings
      const extractionResult: ArticleExtractionResult | null = await extractArticle(
        document,
        window.location.href
      );

      if (!extractionResult || !extractionResult.content) {
        logger.warn('Article extraction failed, falling back to basic extraction');
        return this.getBasicPageContent();
      }

      // Create temp container to analyze extracted content
      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = extractionResult.content;

      const postExtractionStats = {
        totalElements: tempContainer.querySelectorAll('*').length,
        paragraphs: tempContainer.querySelectorAll('p').length,
        headings: tempContainer.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        images: tempContainer.querySelectorAll('img').length,
        links: tempContainer.querySelectorAll('a').length,
        lists: tempContainer.querySelectorAll('ul, ol').length,
        tables: tempContainer.querySelectorAll('table').length,
        codeBlocks: tempContainer.querySelectorAll('pre, code').length,
        blockquotes: tempContainer.querySelectorAll('blockquote').length,
        contentLength: extractionResult.content.length
      };

      logger.info('Phase 1 complete: Article extraction successful', {
        title: extractionResult.title,
        byline: extractionResult.byline,
        excerpt: extractionResult.excerpt?.substring(0, 100),
        textLength: extractionResult.textContent?.length || 0,
        elementsRemoved: preExtractionStats.totalElements - postExtractionStats.totalElements,
        contentStats: postExtractionStats,
        extractionMethod: extractionResult.extractionMethod,
        preservationApplied: extractionResult.preservationApplied,
        codeBlocksPreserved: extractionResult.codeBlocksPreserved || 0,
        codeBlocksDetected: extractionResult.codeBlocksDetected,
        codeBlocksDetectedCount: extractionResult.codeBlocksDetectedCount,
        extraction: {
          kept: postExtractionStats.totalElements,
          removed: preExtractionStats.totalElements - postExtractionStats.totalElements,
          reductionPercent: Math.round(((preExtractionStats.totalElements - postExtractionStats.totalElements) / preExtractionStats.totalElements) * 100)
        }
      });

      // Create a temporary container for the article HTML
      const articleContainer = document.createElement('div');
      articleContainer.innerHTML = extractionResult.content;

      // Process embedded media (videos, audio, advanced images)
      this.processEmbeddedMedia(articleContainer);

      // Make all links absolute URLs
      this.makeLinksAbsolute(articleContainer);

      // Process images and extract them for background downloading
      const images = await this.processImages(articleContainer);

      logger.info('Phase 2: Sanitizing extracted HTML with DOMPurify...');

      // Capture pre-sanitization stats
      const preSanitizeStats = {
        contentLength: articleContainer.innerHTML.length,
        scripts: articleContainer.querySelectorAll('script, noscript').length,
        eventHandlers: Array.from(articleContainer.querySelectorAll('*')).filter(el =>
          Array.from(el.attributes).some(attr => attr.name.startsWith('on'))
        ).length,
        iframes: articleContainer.querySelectorAll('iframe, frame, frameset').length,
        objects: articleContainer.querySelectorAll('object, embed, applet').length,
        forms: articleContainer.querySelectorAll('form, input, button, select, textarea').length,
        base: articleContainer.querySelectorAll('base').length,
        meta: articleContainer.querySelectorAll('meta').length
      };

      logger.debug('Pre-DOMPurify content analysis', preSanitizeStats);

      // Sanitize the extracted article HTML
      const sanitizedHTML = HTMLSanitizer.sanitize(articleContainer.innerHTML, {
        allowImages: true,
        allowLinks: true,
        allowDataUri: true
      });

      // Analyze sanitized content
      const sanitizedContainer = document.createElement('div');
      sanitizedContainer.innerHTML = sanitizedHTML;

      const postSanitizeStats = {
        contentLength: sanitizedHTML.length,
        elements: sanitizedContainer.querySelectorAll('*').length,
        scripts: sanitizedContainer.querySelectorAll('script, noscript').length,
        eventHandlers: Array.from(sanitizedContainer.querySelectorAll('*')).filter(el =>
          Array.from(el.attributes).some(attr => attr.name.startsWith('on'))
        ).length
      };

      const sanitizationResults = {
        bytesRemoved: articleContainer.innerHTML.length - sanitizedHTML.length,
        reductionPercent: Math.round(((articleContainer.innerHTML.length - sanitizedHTML.length) / articleContainer.innerHTML.length) * 100),
        elementsStripped: {
          scripts: preSanitizeStats.scripts - postSanitizeStats.scripts,
          eventHandlers: preSanitizeStats.eventHandlers - postSanitizeStats.eventHandlers,
          iframes: preSanitizeStats.iframes,
          forms: preSanitizeStats.forms,
          objects: preSanitizeStats.objects,
          base: preSanitizeStats.base,
          meta: preSanitizeStats.meta
        }
      };

      logger.info('Phase 2 complete: DOMPurify sanitized HTML', {
        originalLength: articleContainer.innerHTML.length,
        sanitizedLength: sanitizedHTML.length,
        ...sanitizationResults,
        securityThreatsRemoved: Object.values(sanitizationResults.elementsStripped).reduce((a, b) => a + b, 0)
      });

      // Extract metadata (dates) from the page using enhanced date extraction
      const dates = DateFormatter.extractDatesFromDocument(document);
      const labels: Record<string, string> = {};

      // Format dates using user's preferred format
      if (dates.publishedDate) {
        const formattedDate = await DateFormatter.formatWithUserSettings(dates.publishedDate);
        labels['publishedDate'] = formattedDate;
        logger.debug('Formatted published date', {
          original: dates.publishedDate.toISOString(),
          formatted: formattedDate
        });
      }
      if (dates.modifiedDate) {
        const formattedDate = await DateFormatter.formatWithUserSettings(dates.modifiedDate);
        labels['modifiedDate'] = formattedDate;
        logger.debug('Formatted modified date', {
          original: dates.modifiedDate.toISOString(),
          formatted: formattedDate
        });
      }

      logger.info('Content extraction complete - ready for Phase 3 in background script', {
        title: extractionResult.title,
        contentLength: sanitizedHTML.length,
        imageCount: images.length,
        url: window.location.href
      });

      // Return the sanitized article content
      // Background script will handle Phase 3 (Cheerio processing)
      return {
        title: extractionResult.title || this.getPageTitle(),
        content: sanitizedHTML,
        url: window.location.href,
        images: images,
        type: 'page',
        metadata: {
          publishedDate: dates.publishedDate?.toISOString(),
          modifiedDate: dates.modifiedDate?.toISOString(),
          labels,
          readabilityProcessed: true, // Flag to indicate Readability was successful
          excerpt: extractionResult.excerpt
        }
      };
    } catch (error) {
      logger.error('Failed to capture page content with article extraction', error as Error);
      // Fallback to basic content extraction
      return this.getBasicPageContent();
    }
  }

  private async getBasicPageContent(): Promise<ClipData> {
    const article = this.findMainContent();

    // Process embedded media (videos, audio, advanced images)
    this.processEmbeddedMedia(article);

    const images = await this.processImages(article);
    this.makeLinksAbsolute(article);

    return {
      title: this.getPageTitle(),
      content: article.innerHTML,
      url: window.location.href,
      images,
      type: 'page',
      metadata: {
        publishedDate: this.extractPublishedDate(),
        modifiedDate: this.extractModifiedDate()
      }
    };
  }

  private findMainContent(): HTMLElement {
    // Try common content selectors
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      '#content',
      '#main-content',
      '.main-content'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && element.innerText.trim().length > 100) {
        return element.cloneNode(true) as HTMLElement;
      }
    }

    // Fallback: try to find the element with most text content
    const candidates = Array.from(document.querySelectorAll('div, section, article'));
    let bestElement = document.body;
    let maxTextLength = 0;

    candidates.forEach(element => {
      const htmlElement = element as HTMLElement;
      const textLength = htmlElement.innerText?.trim().length || 0;
      if (textLength > maxTextLength) {
        maxTextLength = textLength;
        bestElement = htmlElement;
      }
    });

    return bestElement.cloneNode(true) as HTMLElement;
  }

  /**
   * Process images by replacing src with placeholder IDs
   * This allows the background script to download images without CORS restrictions
   * Similar to MV2 extension approach
   */
  private processImages(container: HTMLElement): ImageData[] {
    const imgElements = Array.from(container.querySelectorAll('img'));
    const images: ImageData[] = [];

    for (const img of imgElements) {
      if (!img.src) continue;

      // Make URL absolute first
      const absoluteUrl = this.makeAbsoluteUrl(img.src);

      // Check if we already have this image (avoid duplicates)
      const existingImage = images.find(image => image.src === absoluteUrl);

      if (existingImage) {
        // Reuse existing placeholder ID for duplicate images
        img.src = existingImage.imageId;
        logger.debug('Reusing placeholder for duplicate image', {
          src: absoluteUrl,
          placeholder: existingImage.imageId
        });
      } else {
        // Generate a random placeholder ID
        const imageId = this.generateRandomId(20);

        images.push({
          imageId: imageId,  // Must be 'imageId' to match MV2 format
          src: absoluteUrl
        });

        // Replace src with placeholder - background script will download later
        img.src = imageId;

        logger.debug('Created placeholder for image', {
          originalSrc: absoluteUrl,
          placeholder: imageId
        });
      }

      // Also handle srcset for responsive images
      if (img.srcset) {
        const srcsetParts = img.srcset.split(',').map(part => {
          const [url, descriptor] = part.trim().split(/\s+/);
          return `${this.makeAbsoluteUrl(url)}${descriptor ? ' ' + descriptor : ''}`;
        });
        img.srcset = srcsetParts.join(', ');
      }
    }

    logger.info('Processed images with placeholders', {
      totalImages: images.length,
      uniqueImages: images.length
    });

    return images;
  }

  /**
   * Generate a random ID for image placeholders
   */
  private generateRandomId(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private makeLinksAbsolute(container: HTMLElement): void {
    const links = container.querySelectorAll('a[href]');

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        link.setAttribute('href', this.makeAbsoluteUrl(href));
      }
    });
  }

  private makeAbsoluteUrl(url: string): string {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }

  private getPageTitle(): string {
    // Try multiple sources for the title
    const sources = [
      () => document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      () => document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
      () => document.querySelector('h1')?.textContent?.trim(),
      () => document.title.trim(),
      () => 'Untitled Page'
    ];

    for (const source of sources) {
      const title = source();
      if (title && title.length > 0) {
        return title;
      }
    }

    return 'Untitled Page';
  }

  private generateTitle(prefix: string): string {
    const pageTitle = this.getPageTitle();
    return `${prefix} from ${pageTitle}`;
  }

  private extractPublishedDate(): string | undefined {
    const selectors = [
      'meta[property="article:published_time"]',
      'meta[name="publishdate"]',
      'meta[name="date"]',
      'time[pubdate]',
      'time[datetime]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const content = element?.getAttribute('content') ||
                     element?.getAttribute('datetime') ||
                     element?.textContent?.trim();

      if (content) {
        try {
          return new Date(content).toISOString();
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  private extractModifiedDate(): string | undefined {
    const selectors = [
      'meta[property="article:modified_time"]',
      'meta[name="last-modified"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const content = element?.getAttribute('content');

      if (content) {
        try {
          return new Date(content).toISOString();
        } catch {
          continue;
        }
      }
    }

    return undefined;
  }

  /**
   * Enhanced content processing for embedded media
   * Handles videos, audio, images, and other embedded content
   */
  private processEmbeddedMedia(container: HTMLElement): void {
    // Process video embeds (YouTube, Vimeo, etc.)
    this.processVideoEmbeds(container);

    // Process audio embeds (Spotify, SoundCloud, etc.)
    this.processAudioEmbeds(container);

    // Process advanced image content (carousels, galleries, etc.)
    this.processAdvancedImages(container);

    // Process social media embeds
    this.processSocialEmbeds(container);
  }

  private processVideoEmbeds(container: HTMLElement): void {
    // YouTube embeds
    const youtubeEmbeds = container.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtu.be"]');
    youtubeEmbeds.forEach((embed) => {
      const iframe = embed as HTMLIFrameElement;

      // Extract video ID and create watch URL
      const videoId = this.extractYouTubeId(iframe.src);
      const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : iframe.src;

      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-video-link youtube';
      wrapper.innerHTML = `<p>🎥 <a href="${watchUrl}" target="_blank" rel="noopener">Watch on YouTube</a></p>`;

      iframe.parentNode?.replaceChild(wrapper, iframe);
      logger.debug('Processed YouTube embed', { src: iframe.src, watchUrl });
    });

    // Vimeo embeds
    const vimeoEmbeds = container.querySelectorAll('iframe[src*="vimeo.com"]');
    vimeoEmbeds.forEach((embed) => {
      const iframe = embed as HTMLIFrameElement;
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-video-link vimeo';
      wrapper.innerHTML = `<p>🎥 <a href="${iframe.src}" target="_blank" rel="noopener">Watch on Vimeo</a></p>`;
      iframe.parentNode?.replaceChild(wrapper, iframe);
      logger.debug('Processed Vimeo embed', { src: iframe.src });
    });

    // Native HTML5 videos
    const videoElements = container.querySelectorAll('video');
    videoElements.forEach((video) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-video-native';

      const sources = Array.from(video.querySelectorAll('source')).map(s => s.src).join(', ');
      const videoSrc = video.src || sources;

      wrapper.innerHTML = `<p>🎬 <a href="${videoSrc}" target="_blank" rel="noopener">Video File</a></p>`;
      video.parentNode?.replaceChild(wrapper, video);
      logger.debug('Processed native video', { src: videoSrc });
    });
  }

  private processAudioEmbeds(container: HTMLElement): void {
    // Spotify embeds
    const spotifyEmbeds = container.querySelectorAll('iframe[src*="spotify.com"]');
    spotifyEmbeds.forEach((embed) => {
      const iframe = embed as HTMLIFrameElement;
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-audio-embed spotify-embed';
      wrapper.innerHTML = `
        <p><strong>Spotify:</strong> <a href="${iframe.src}" target="_blank">${iframe.src}</a></p>
        <div class="embed-placeholder">[Spotify Audio Embedded]</div>
      `;
      iframe.parentNode?.replaceChild(wrapper, iframe);
      logger.debug('Processed Spotify embed', { src: iframe.src });
    });

    // SoundCloud embeds
    const soundcloudEmbeds = container.querySelectorAll('iframe[src*="soundcloud.com"]');
    soundcloudEmbeds.forEach((embed) => {
      const iframe = embed as HTMLIFrameElement;
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-audio-embed soundcloud-embed';
      wrapper.innerHTML = `
        <p><strong>SoundCloud:</strong> <a href="${iframe.src}" target="_blank">${iframe.src}</a></p>
        <div class="embed-placeholder">[SoundCloud Audio Embedded]</div>
      `;
      iframe.parentNode?.replaceChild(wrapper, iframe);
      logger.debug('Processed SoundCloud embed', { src: iframe.src });
    });

    // Native HTML5 audio
    const audioElements = container.querySelectorAll('audio');
    audioElements.forEach((audio) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-audio-native';

      const sources = Array.from(audio.querySelectorAll('source')).map(s => s.src).join(', ');
      const audioSrc = audio.src || sources;

      wrapper.innerHTML = `
        <p><strong>Audio:</strong> <a href="${audioSrc}" target="_blank">${audioSrc}</a></p>
        <div class="embed-placeholder">[Audio Content]</div>
      `;
      audio.parentNode?.replaceChild(wrapper, audio);
      logger.debug('Processed native audio', { src: audioSrc });
    });
  }

  private processAdvancedImages(container: HTMLElement): void {
    // Handle image galleries and carousels
    const galleries = container.querySelectorAll('.gallery, .carousel, .slider, [class*="gallery"], [class*="carousel"], [class*="slider"]');
    galleries.forEach((gallery) => {
      const images = gallery.querySelectorAll('img');
      if (images.length > 1) {
        const wrapper = document.createElement('div');
        wrapper.className = 'trilium-image-gallery';
        wrapper.innerHTML = `<h4>Image Gallery (${images.length} images):</h4>`;

        images.forEach((img, index) => {
          const imgWrapper = document.createElement('div');
          imgWrapper.className = 'gallery-image';
          imgWrapper.innerHTML = `<p>Image ${index + 1}: <img src="${img.src}" alt="${img.alt || ''}" style="max-width: 100%; height: auto;"></p>`;
          wrapper.appendChild(imgWrapper);
        });

        gallery.parentNode?.replaceChild(wrapper, gallery);
        logger.debug('Processed image gallery', { imageCount: images.length });
      }
    });

    // Handle lazy-loaded images with data-src
    const lazyImages = container.querySelectorAll('img[data-src], img[data-lazy-src]');
    lazyImages.forEach((img) => {
      const imgElement = img as HTMLImageElement;
      const dataSrc = imgElement.dataset.src || imgElement.dataset.lazySrc;
      if (dataSrc && !imgElement.src) {
        imgElement.src = dataSrc;
        logger.debug('Processed lazy-loaded image', { dataSrc });
      }
    });
  }

  private processSocialEmbeds(container: HTMLElement): void {
    // Twitter embeds
    const twitterEmbeds = container.querySelectorAll('blockquote.twitter-tweet, iframe[src*="twitter.com"]');
    twitterEmbeds.forEach((embed) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-social-embed twitter-embed';

      // Try to extract tweet URL from various attributes
      const links = embed.querySelectorAll('a[href*="twitter.com"], a[href*="x.com"]');
      const tweetUrl = links.length > 0 ? (links[links.length - 1] as HTMLAnchorElement).href : '';

      wrapper.innerHTML = `
        <p><strong>Twitter/X Post:</strong> ${tweetUrl ? `<a href="${tweetUrl}" target="_blank">${tweetUrl}</a>` : '[Twitter Embed]'}</p>
        <blockquote style="border-left: 3px solid #1da1f2; padding-left: 10px; margin: 10px 0;">
          ${embed.textContent || '[Twitter content]'}
        </blockquote>
      `;
      embed.parentNode?.replaceChild(wrapper, embed);
      logger.debug('Processed Twitter embed', { url: tweetUrl });
    });

    // Instagram embeds
    const instagramEmbeds = container.querySelectorAll('blockquote[data-instgrm-captioned], iframe[src*="instagram.com"]');
    instagramEmbeds.forEach((embed) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'trilium-social-embed instagram-embed';
      wrapper.innerHTML = `
        <p><strong>Instagram Post:</strong> [Instagram Embed]</p>
        <div class="embed-placeholder" style="border: 1px solid #E1306C; padding: 10px;">
          ${embed.textContent || '[Instagram content]'}
        </div>
      `;
      embed.parentNode?.replaceChild(wrapper, embed);
      logger.debug('Processed Instagram embed');
    });
  }

  /**
   * Extract YouTube video ID from various URL formats
   */
  private extractYouTubeId(url: string): string | null {
    const patterns = [
      /youtube\.com\/embed\/([^?&]+)/,
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?&]+)/,
      /youtube\.com\/v\/([^?&]+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }

    return null;
  }

  /**
   * Screenshot area selection functionality
   * Allows user to drag and select a rectangular area for screenshot capture
   */
  private async getScreenshotArea(): Promise<{ x: number; y: number; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      try {
        // Create overlay elements
        const overlay = this.createScreenshotOverlay();
        const messageBox = this.createScreenshotMessage();
        const selection = this.createScreenshotSelection();

        document.body.appendChild(overlay);
        document.body.appendChild(messageBox);
        document.body.appendChild(selection);

        // Focus the message box for keyboard events
        messageBox.focus();

        let isDragging = false;
        let startX = 0;
        let startY = 0;

        const cleanup = () => {
          document.body.removeChild(overlay);
          document.body.removeChild(messageBox);
          document.body.removeChild(selection);
        };

        const handleMouseDown = (e: MouseEvent) => {
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          selection.style.left = startX + 'px';
          selection.style.top = startY + 'px';
          selection.style.width = '0px';
          selection.style.height = '0px';
          selection.style.display = 'block';
        };

        const handleMouseMove = (e: MouseEvent) => {
          if (!isDragging) return;

          const currentX = e.clientX;
          const currentY = e.clientY;
          const width = Math.abs(currentX - startX);
          const height = Math.abs(currentY - startY);
          const left = Math.min(currentX, startX);
          const top = Math.min(currentY, startY);

          selection.style.left = left + 'px';
          selection.style.top = top + 'px';
          selection.style.width = width + 'px';
          selection.style.height = height + 'px';
        };

        const handleMouseUp = (e: MouseEvent) => {
          if (!isDragging) return;
          isDragging = false;

          const currentX = e.clientX;
          const currentY = e.clientY;
          const width = Math.abs(currentX - startX);
          const height = Math.abs(currentY - startY);
          const left = Math.min(currentX, startX);
          const top = Math.min(currentY, startY);

          cleanup();

          // Return the selected area coordinates
          resolve({ x: left, y: top, width, height });
        };

        const handleKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            cleanup();
            reject(new Error('Screenshot selection cancelled'));
          }
        };

        // Add event listeners
        overlay.addEventListener('mousedown', handleMouseDown);
        overlay.addEventListener('mousemove', handleMouseMove);
        overlay.addEventListener('mouseup', handleMouseUp);
        messageBox.addEventListener('keydown', handleKeyDown);

        logger.info('Screenshot area selection mode activated');
      } catch (error) {
        logger.error('Failed to initialize screenshot area selection', error as Error);
        reject(error);
      }
    });
  }

  private createScreenshotOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'black',
      opacity: '0.6',
      zIndex: '99999998',
      cursor: 'crosshair'
    });
    return overlay;
  }

  private createScreenshotMessage(): HTMLDivElement {
    const messageBox = document.createElement('div');
    messageBox.tabIndex = 0; // Make it focusable
    messageBox.textContent = 'Drag and release to capture a screenshot (Press ESC to cancel)';

    Object.assign(messageBox.style, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '400px',
      padding: '15px',
      backgroundColor: 'white',
      color: 'black',
      border: '2px solid #333',
      borderRadius: '8px',
      fontSize: '14px',
      textAlign: 'center',
      zIndex: '99999999',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });

    return messageBox;
  }

  private createScreenshotSelection(): HTMLDivElement {
    const selection = document.createElement('div');
    Object.assign(selection.style, {
      position: 'fixed',
      border: '2px solid #ff0000',
      backgroundColor: 'rgba(255,0,0,0.1)',
      zIndex: '99999997',
      pointerEvents: 'none',
      display: 'none'
    });
    return selection;
  }

  private showToast(message: string, variant: string = 'info', duration: number = 3000): { success: boolean } {
    // Create a simple toast notification
    const toast = document.createElement('div');
    toast.className = `trilium-toast trilium-toast--${variant}`;
    toast.textContent = message;

    // Basic styling
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '12px 16px',
      borderRadius: '4px',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '14px',
      zIndex: '10000',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      backgroundColor: this.getToastColor(variant),
      opacity: '0',
      transform: 'translateX(100%)',
      transition: 'all 0.3s ease'
    });

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    // Auto remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);

    return { success: true };
  }

  private getToastColor(variant: string): string {
    const colors = {
      success: '#22c55e',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6'
    };

    return colors[variant as keyof typeof colors] || colors.info;
  }

  // ============================================================
  // CODE BLOCK PRESERVATION SYSTEM
  // ============================================================
  // Code block preservation is now handled by the centralized
  // article-extraction module (src/shared/article-extraction.ts)
  // which uses the readability-code-preservation module internally.
  // This provides consistent behavior across the extension.
  // ============================================================

}

// Initialize the content script
try {
  logger.info('Content script file loaded, creating instance...');
  new ContentScript();
} catch (error) {
  logger.error('Failed to create ContentScript instance', error as Error);

  // Try to send error to background script
  try {
    chrome.runtime.sendMessage({
      type: 'CONTENT_SCRIPT_ERROR',
      error: (error as Error).message
    });
  } catch (e) {
    console.error('Content script failed to initialize:', error);
  }
}
