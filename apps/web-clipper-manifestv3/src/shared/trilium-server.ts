/**
 * Modern Trilium Server Communication Layer for Manifest V3
 * Handles connection discovery, authentication, and API communication
 * with both desktop client and server instances
 */

import { Logger } from './utils';
import { TriliumResponse, ClipData } from './types';

const logger = Logger.create('TriliumServer', 'background');

// Protocol version for compatibility checking
const PROTOCOL_VERSION_MAJOR = 1;

export type ConnectionStatus =
  | 'searching'
  | 'found-desktop'
  | 'found-server'
  | 'not-found'
  | 'version-mismatch';

export interface TriliumSearchResult {
  status: ConnectionStatus;
  url?: string;
  port?: number;
  token?: string;
  extensionMajor?: number;
  triliumMajor?: number;
}

export interface TriliumHandshakeResponse {
  appName: string;
  protocolVersion: string;
  appVersion?: string;
  clipperProtocolVersion?: string;
}

export interface TriliumConnectionConfig {
  serverUrl?: string;
  authToken?: string;
  desktopPort?: string;
  enableServer?: boolean;
  enableDesktop?: boolean;
}

/**
 * Modern Trilium Server Facade
 * Provides unified interface for communicating with Trilium instances
 */
export class TriliumServerFacade {
  private triliumSearch: TriliumSearchResult = { status: 'not-found' };
  private searchPromise: Promise<void> | null = null;
  private listeners: Array<(result: TriliumSearchResult) => void> = [];

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    logger.info('Initializing Trilium server facade');

    // Start initial search
    await this.triggerSearchForTrilium();

    // Set up periodic connection monitoring
    setInterval(() => {
      this.triggerSearchForTrilium().catch(error => {
        logger.error('Periodic connection check failed', error);
      });
    }, 60 * 1000); // Check every minute
  }

  /**
   * Get current connection status
   */
  public getConnectionStatus(): TriliumSearchResult {
    return { ...this.triliumSearch };
  }

  /**
   * Add listener for connection status changes
   */
  public addConnectionListener(listener: (result: TriliumSearchResult) => void): () => void {
    this.listeners.push(listener);

    // Send current status immediately
    listener(this.getConnectionStatus());

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Manually trigger search for Trilium connections
   */
  public async triggerSearchForTrilium(): Promise<void> {
    // Prevent multiple simultaneous searches
    if (this.searchPromise) {
      return this.searchPromise;
    }

    this.searchPromise = this.performTriliumSearch();

    try {
      await this.searchPromise;
    } finally {
      this.searchPromise = null;
    }
  }

  private async performTriliumSearch(): Promise<void> {
    this.setTriliumSearch({ status: 'searching' });

    try {
      // Get connection configuration
      const config = await this.getConnectionConfig();

      // Try desktop client first (if enabled)
      if (config.enableDesktop !== false) { // Default to true if not specified
        const desktopResult = await this.tryDesktopConnection(config.desktopPort);
        if (desktopResult) {
          return; // Success, exit early
        }
      }

      // Try server connection (if enabled and configured)
      if (config.enableServer && config.serverUrl && config.authToken) {
        const serverResult = await this.tryServerConnection(config.serverUrl, config.authToken);
        if (serverResult) {
          return; // Success, exit early
        }
      }

      // If we reach here, no connections were successful
      this.setTriliumSearch({ status: 'not-found' });

    } catch (error) {
      logger.error('Connection search failed', error as Error);
      this.setTriliumSearch({ status: 'not-found' });
    }
  }

  private async tryDesktopConnection(configuredPort?: string): Promise<boolean> {
    const port = configuredPort ? parseInt(configuredPort) : this.getDefaultDesktopPort();

    try {
      logger.debug('Trying desktop connection', { port });

      const response = await this.fetchWithTimeout(`http://127.0.0.1:${port}/api/clipper/handshake`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }, 5000);

      if (!response.ok) {
        return false;
      }

      const data: TriliumHandshakeResponse = await response.json();

      if (data.appName === 'trilium') {
        this.setTriliumSearchWithVersionCheck(data, {
          status: 'found-desktop',
          port: port,
          url: `http://127.0.0.1:${port}`
        });
        return true;
      }

    } catch (error) {
      logger.debug('Desktop connection failed', error, { port });
    }

    return false;
  }

  private async tryServerConnection(serverUrl: string, authToken: string): Promise<boolean> {
    try {
      logger.debug('Trying server connection', { serverUrl });

      const response = await this.fetchWithTimeout(`${serverUrl}/api/clipper/handshake`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': authToken
        }
      }, 10000);

      if (!response.ok) {
        return false;
      }

      const data: TriliumHandshakeResponse = await response.json();

      if (data.appName === 'trilium') {
        this.setTriliumSearchWithVersionCheck(data, {
          status: 'found-server',
          url: serverUrl,
          token: authToken
        });
        return true;
      }

    } catch (error) {
      logger.debug('Server connection failed', error, { serverUrl });
    }

    return false;
  }

  private setTriliumSearch(result: TriliumSearchResult): void {
    this.triliumSearch = { ...result };

    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener(this.getConnectionStatus());
      } catch (error) {
        logger.error('Error in connection listener', error as Error);
      }
    });

    logger.debug('Connection status updated', { status: result.status });
  }

  private setTriliumSearchWithVersionCheck(handshake: TriliumHandshakeResponse, result: TriliumSearchResult): void {
    const [major] = handshake.protocolVersion.split('.').map(chunk => parseInt(chunk));

    if (major !== PROTOCOL_VERSION_MAJOR) {
      this.setTriliumSearch({
        status: 'version-mismatch',
        extensionMajor: PROTOCOL_VERSION_MAJOR,
        triliumMajor: major
      });
    } else {
      this.setTriliumSearch(result);
    }
  }

  private async getConnectionConfig(): Promise<TriliumConnectionConfig> {
    try {
      const data = await chrome.storage.sync.get([
        'triliumServerUrl',
        'authToken',
        'triliumDesktopPort',
        'enableServer',
        'enableDesktop'
      ]);

      return {
        serverUrl: data.triliumServerUrl,
        authToken: data.authToken,
        desktopPort: data.triliumDesktopPort,
        enableServer: data.enableServer,
        enableDesktop: data.enableDesktop
      };
    } catch (error) {
      logger.error('Failed to get connection config', error as Error);
      return {};
    }
  }

  private getDefaultDesktopPort(): number {
    // Check if this is a development environment
    const isDev = chrome.runtime.getManifest().name?.endsWith('(dev)');
    return isDev ? 37740 : 37840;
  }

  /**
   * Wait for Trilium connection to be established
   */
  public async waitForTriliumConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkStatus = () => {
        if (this.triliumSearch.status === 'searching') {
          setTimeout(checkStatus, 500);
        } else if (this.triliumSearch.status === 'not-found' || this.triliumSearch.status === 'version-mismatch') {
          reject(new Error(`Trilium connection not available: ${this.triliumSearch.status}`));
        } else {
          resolve();
        }
      };

      checkStatus();
    });
  }

  /**
   * Call Trilium API endpoint
   */
  public async callService(method: string, path: string, body?: unknown): Promise<unknown> {
    const fetchOptions: RequestInit = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (body) {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    try {
      // Ensure we have a connection
      await this.waitForTriliumConnection();

      // Add authentication if available
      if (this.triliumSearch.token) {
        (fetchOptions.headers as Record<string, string>)['Authorization'] = this.triliumSearch.token;
      }

      // Add trilium-specific headers
      (fetchOptions.headers as Record<string, string>)['trilium-local-now-datetime'] = this.getLocalNowDateTime();

      const url = `${this.triliumSearch.url}/api/clipper/${path}`;

      logger.debug('Making API request', { method, url, path });

      const response = await this.fetchWithTimeout(url, fetchOptions, 30000);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return await response.json();

    } catch (error) {
      logger.error('Trilium API call failed', error as Error, { method, path });
      throw error;
    }
  }

  /**
   * Create a new note in Trilium
   */
  public async createNote(
    clipData: ClipData,
    forceNew = false,
    options?: { type?: string; mime?: string }
  ): Promise<TriliumResponse> {
    try {
      logger.info('Creating note in Trilium', {
        title: clipData.title,
        type: clipData.type,
        contentLength: clipData.content?.length || 0,
        url: clipData.url,
        forceNew,
        noteType: options?.type,
        mime: options?.mime
      });

      // Server expects pageUrl, clipType, and other fields at top level
      const noteData = {
        title: clipData.title || 'Untitled Clip',
        content: clipData.content || '',
        pageUrl: clipData.url || '', // Top-level field - used for duplicate detection
        clipType: clipData.type || 'unknown', // Top-level field - used for note categorization
        images: clipData.images || [], // Images to process
        forceNew, // Pass to server to force new note even if URL exists
        type: options?.type, // Optional note type (e.g., 'code' for markdown)
        mime: options?.mime, // Optional MIME type (e.g., 'text/markdown')
        labels: {
          // Additional labels can go here if needed
          clipDate: new Date().toISOString()
        }
      };

      logger.debug('Sending note data to server', {
        pageUrl: noteData.pageUrl,
        clipType: noteData.clipType,
        hasImages: noteData.images.length > 0,
        noteType: noteData.type,
        mime: noteData.mime
      });

      const result = await this.callService('POST', 'clippings', noteData) as { noteId: string };

      logger.info('Note created successfully', { noteId: result.noteId });

      return {
        success: true,
        noteId: result.noteId
      };

    } catch (error) {
      logger.error('Failed to create note', error as Error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Create a child note under an existing parent note
   */
  public async createChildNote(
    parentNoteId: string,
    noteData: {
      title: string;
      content: string;
      type?: string;
      url?: string;
      attributes?: Array<{ type: string; name: string; value: string }>;
    }
  ): Promise<TriliumResponse> {
    try {
      logger.info('Creating child note', {
        parentNoteId,
        title: noteData.title,
        contentLength: noteData.content.length
      });

      const childNoteData = {
        title: noteData.title,
        content: noteData.content,
        type: 'code', // Markdown notes are typically 'code' type
        mime: 'text/markdown',
        attributes: noteData.attributes || []
      };

      const result = await this.callService(
        'POST',
        `notes/${parentNoteId}/children`,
        childNoteData
      ) as { note: { noteId: string } };

      logger.info('Child note created successfully', {
        childNoteId: result.note.noteId,
        parentNoteId
      });

      return {
        success: true,
        noteId: result.note.noteId
      };

    } catch (error) {
      logger.error('Failed to create child note', error as Error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Append content to an existing note
   */
  public async appendToNote(noteId: string, clipData: ClipData): Promise<TriliumResponse> {
    try {
      logger.info('Appending to existing note', {
        noteId,
        contentLength: clipData.content?.length || 0
      });

      const appendData = {
        content: clipData.content || '',
        images: clipData.images || [],
        clipType: clipData.type || 'unknown',
        clipDate: new Date().toISOString()
      };

      await this.callService('PUT', `clippings/${noteId}/append`, appendData);

      logger.info('Content appended successfully', { noteId });

      return {
        success: true,
        noteId
      };

    } catch (error) {
      logger.error('Failed to append to note', error as Error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Check if a note exists for the given URL
   */
  public async checkForExistingNote(url: string): Promise<{
    exists: boolean;
    noteId?: string;
    title?: string;
    createdAt?: string;
  }> {
    try {
      const encodedUrl = encodeURIComponent(url);
      const result = await this.callService('GET', `notes-by-url/${encodedUrl}`) as { noteId: string | null };

      if (result.noteId) {
        logger.info('Found existing note for URL', { url, noteId: result.noteId });

        return {
          exists: true,
          noteId: result.noteId,
          title: 'Existing clipping',  // Title will be fetched by popup if needed
          createdAt: new Date().toISOString()  // API doesn't return this currently
        };
      }

      return { exists: false };
    } catch (error) {
      logger.error('Failed to check for existing note', error as Error);
      return { exists: false };
    }
  }

  /**
   * Opens a note in Trilium
   * Sends a request to open the note in the Trilium app
   */
  public async openNote(noteId: string): Promise<void> {
    try {
      logger.info('Opening note in Trilium', { noteId });

      await this.callService('GET', `open/${noteId}`);

      logger.info('Note open request sent successfully', { noteId });
    } catch (error) {
      logger.error('Failed to open note in Trilium', error as Error);
      throw error;
    }
  }

  /**
   * Test connection to Trilium instance using the same endpoints as automatic discovery
   * This ensures consistency between background monitoring and manual testing
   */
  public async testConnection(serverUrl?: string, authToken?: string, desktopPort?: string): Promise<{
    server?: { connected: boolean; version?: string; error?: string };
    desktop?: { connected: boolean; version?: string; error?: string };
  }> {
    const results: {
      server?: { connected: boolean; version?: string; error?: string };
      desktop?: { connected: boolean; version?: string; error?: string };
    } = {};

    // Test server if provided - use the same clipper handshake endpoint as automatic discovery
    if (serverUrl) {
      try {
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (authToken) {
          headers['Authorization'] = authToken;
        }

        const response = await this.fetchWithTimeout(`${serverUrl}/api/clipper/handshake`, {
          method: 'GET',
          headers
        }, 10000);

        if (response.ok) {
          const data: TriliumHandshakeResponse = await response.json();
          if (data.appName === 'trilium') {
            results.server = {
              connected: true,
              version: data.appVersion || 'Unknown'
            };
          } else {
            results.server = {
              connected: false,
              error: 'Invalid response - not a Trilium instance'
            };
          }
        } else {
          results.server = {
            connected: false,
            error: `HTTP ${response.status}`
          };
        }
      } catch (error) {
        results.server = {
          connected: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        };
      }
    }

    // Test desktop client - use the same clipper handshake endpoint as automatic discovery
    if (desktopPort || !serverUrl) { // Test desktop by default if no server specified
      const port = desktopPort ? parseInt(desktopPort) : this.getDefaultDesktopPort();

      try {
        const response = await this.fetchWithTimeout(`http://127.0.0.1:${port}/api/clipper/handshake`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        }, 5000);

        if (response.ok) {
          const data: TriliumHandshakeResponse = await response.json();
          if (data.appName === 'trilium') {
            results.desktop = {
              connected: true,
              version: data.appVersion || 'Unknown'
            };
          } else {
            results.desktop = {
              connected: false,
              error: 'Invalid response - not a Trilium instance'
            };
          }
        } else {
          results.desktop = {
            connected: false,
            error: `HTTP ${response.status}`
          };
        }
      } catch (error) {
        results.desktop = {
          connected: false,
          error: error instanceof Error ? error.message : 'Connection failed'
        };
      }
    }

    return results;
  }  private getLocalNowDateTime(): string {
    const date = new Date();
    const offset = date.getTimezoneOffset();
    const absOffset = Math.abs(offset);

    return (
      new Date(date.getTime() - offset * 60 * 1000)
        .toISOString()
        .substr(0, 23)
        .replace('T', ' ') +
      (offset > 0 ? '-' : '+') +
      Math.floor(absOffset / 60).toString().padStart(2, '0') + ':' +
      (absOffset % 60).toString().padStart(2, '0')
    );
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Singleton instance
export const triliumServerFacade = new TriliumServerFacade();
