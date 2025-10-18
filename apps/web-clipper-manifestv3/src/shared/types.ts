/**
 * Message types for communication between different parts of the extension
 */
export interface BaseMessage {
  id?: string;
  timestamp?: number;
}

export interface SaveSelectionMessage extends BaseMessage {
  type: 'SAVE_SELECTION';
}

export interface SavePageMessage extends BaseMessage {
  type: 'SAVE_PAGE';
}

export interface SaveScreenshotMessage extends BaseMessage {
  type: 'SAVE_SCREENSHOT';
  cropRect?: CropRect;
}

export interface ToastMessage extends BaseMessage {
  type: 'SHOW_TOAST';
  message: string;
  noteId?: string;
  duration?: number;
  variant?: 'success' | 'error' | 'info' | 'warning';
}

export interface LoadScriptMessage extends BaseMessage {
  type: 'LOAD_SCRIPT';
  scriptPath: string;
}

export interface GetScreenshotAreaMessage extends BaseMessage {
  type: 'GET_SCREENSHOT_AREA';
}

export interface TestConnectionMessage extends BaseMessage {
  type: 'TEST_CONNECTION';
  serverUrl?: string;
  authToken?: string;
  desktopPort?: string;
}

export interface GetConnectionStatusMessage extends BaseMessage {
  type: 'GET_CONNECTION_STATUS';
}

export interface TriggerConnectionSearchMessage extends BaseMessage {
  type: 'TRIGGER_CONNECTION_SEARCH';
}

export interface PingMessage extends BaseMessage {
  type: 'PING';
}

export interface ContentScriptReadyMessage extends BaseMessage {
  type: 'CONTENT_SCRIPT_READY';
  url: string;
  timestamp: number;
}

export interface ContentScriptErrorMessage extends BaseMessage {
  type: 'CONTENT_SCRIPT_ERROR';
  error: string;
}

export interface CheckExistingNoteMessage extends BaseMessage {
  type: 'CHECK_EXISTING_NOTE';
  url: string;
}

export interface OpenNoteMessage extends BaseMessage {
  type: 'OPEN_NOTE';
  noteId: string;
}

export interface ShowDuplicateDialogMessage extends BaseMessage {
  type: 'SHOW_DUPLICATE_DIALOG';
  existingNoteId: string;
  url: string;
}

export type ExtensionMessage =
  | SaveSelectionMessage
  | SavePageMessage
  | SaveScreenshotMessage
  | ToastMessage
  | LoadScriptMessage
  | GetScreenshotAreaMessage
  | TestConnectionMessage
  | GetConnectionStatusMessage
  | TriggerConnectionSearchMessage
  | PingMessage
  | ContentScriptReadyMessage
  | ContentScriptErrorMessage
  | CheckExistingNoteMessage
  | OpenNoteMessage
  | ShowDuplicateDialogMessage;

/**
 * Data structures
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageData {
  imageId: string;  // Placeholder ID - must match MV2 format for server compatibility
  src: string;      // Original image URL
  dataUrl?: string; // Base64 data URL (added by background script)
}

export interface ClipData {
  title: string;
  content: string;
  url: string;
  images?: ImageData[];
  type: 'selection' | 'page' | 'screenshot' | 'link';
  metadata?: {
    publishedDate?: string;
    modifiedDate?: string;
    author?: string;
    labels?: Record<string, string>;
    fullPageCapture?: boolean; // Flag indicating full DOM serialization (MV3 strategy)
    [key: string]: unknown;
  };
}

/**
 * Trilium API interfaces
 */
export interface TriliumNote {
  noteId: string;
  title: string;
  content: string;
  type: string;
  mime: string;
}

export interface TriliumResponse {
  noteId?: string;
  success: boolean;
  error?: string;
}

/**
 * Extension configuration
 */
export interface ExtensionConfig {
  triliumServerUrl?: string;
  autoSave: boolean;
  defaultNoteTitle: string;
  enableToasts: boolean;
  screenshotFormat: 'png' | 'jpeg';
  screenshotQuality: number;
}
