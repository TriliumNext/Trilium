# Architecture
Trilium Notes is a hierarchical note-taking application built as a TypeScript monorepo. It supports multiple deployment modes (desktop, server, mobile web) and features advanced capabilities including synchronization, scripting, encryption, and rich content editing.

### Key Characteristics

*   **Monorepo Architecture**: Uses pnpm workspaces for dependency management
*   **Multi-Platform**: Desktop (Electron), Server (Node.js/Express), and Mobile Web
*   **TypeScript-First**: Strong typing throughout the codebase
*   **Plugin-Based**: Extensible architecture for note types and UI components
*   **Offline-First**: Full functionality without network connectivity
*   **Synchronization-Ready**: Built-in sync protocol for multi-device usage

### Technology Stack

*   **Runtime**: Node.js (backend), Browser/Electron (frontend)
*   **Language**: TypeScript, JavaScript
*   **Database**: SQLite (better-sqlite3)
*   **Build Tools**:
    *   Client: Vite,
    *   Server: ESBuild (bundling)
    *   Package manager: pnpm
*   **UI Framework**: Custom widget-based system (vanilla HTML, CSS & JavaScript + jQuery), in the process of converting to React/Preact.
*   **Rich Text**: CKEditor 5 (customized)
*   **Code Editing**: CodeMirror 6
*   **Desktop**: Electron
*   **Server**: Express.js

## Main architecture

Trilium follows a **client-server architecture** even in desktop mode, where Electron runs both the backend server and frontend client within the same process.

```
graph TB
    subgraph Frontend
        Widgets[Widgets<br/>System]
        Froca[Froca<br/>Cache]
        UIServices[UI<br/>Services]
    end
    
    subgraph Backend["Backend Server"]
        Express[Express<br/>Routes]
        Becca[Becca<br/>Cache]
        ScriptEngine[Script<br/>Engine]
        Database[(SQLite<br/>Database)]
    end
    
    Widgets -.-> API[WebSocket & REST API]
    Froca -.-> API
    UIServices -.-> API
    API -.-> Express
    API -.-> Becca
    API -.-> ScriptEngine
    Becca --> Database
    Express --> Database
    ScriptEngine --> Database
```

### Deployment Modes

1.  **Desktop Application**
    *   Electron wrapper running both frontend and backend
    *   Local SQLite database
    *   Full offline functionality
    *   Cross-platform (Windows, macOS, Linux)
2.  **Server Installation**
    *   Node.js server exposing web interface
    *   Multi-user capable
    *   Can sync with desktop clients
    *   Docker deployment supported
3.  **Mobile Web**
    *   Optimized responsive interface
    *   Accessed via browser
    *   Requires server installation

## Monorepo Structure

Trilium uses **pnpm workspaces** to manage its monorepo structure, with apps and packages clearly separated.

```
trilium/
├── apps/                    # Runnable applications
│   ├── client/             # Frontend application (shared by server & desktop)
│   ├── server/             # Node.js server with web interface
│   ├── desktop/            # Electron desktop application
│   ├── web-clipper/        # Browser extension for web content capture
│   ├── db-compare/         # Database comparison tool
│   ├── dump-db/            # Database export tool
│   ├── edit-docs/          # Documentation editing tool
│   ├── build-docs/         # Documentation build tool
│   └── website/            # Marketing website
│
├── packages/               # Shared libraries
│   ├── commons/           # Shared interfaces and utilities
│   ├── ckeditor5/         # Custom rich text editor
│   ├── codemirror/        # Code editor customizations
│   ├── highlightjs/       # Syntax highlighting
│   ├── ckeditor5-admonition/     # CKEditor plugin: admonitions
│   ├── ckeditor5-footnotes/      # CKEditor plugin: footnotes
│   ├── ckeditor5-keyboard-marker/# CKEditor plugin: keyboard shortcuts
│   ├── ckeditor5-math/           # CKEditor plugin: math equations
│   ├── ckeditor5-mermaid/        # CKEditor plugin: diagrams
│   ├── express-partial-content/  # HTTP partial content middleware
│   ├── share-theme/              # Shared note theme
│   ├── splitjs/                  # Split pane library
│   └── turndown-plugin-gfm/      # Markdown conversion
│
├── docs/                   # Documentation
├── scripts/                # Build and utility scripts
└── patches/                # Package patches (via pnpm)
```

### Package Dependencies

The monorepo uses workspace protocol (`workspace:*`) for internal dependencies:

```
desktop → client → commons
server  → client → commons
client  → ckeditor5, codemirror, highlightjs
ckeditor5 → ckeditor5-* plugins
```

## Security summary

### Encryption System

**Per-Note Encryption:**

*   Notes can be individually protected
*   AES-128-CBC encryption for encrypted notes.
*   Separate protected session management

**Protected Session:**

*   Time-limited access to protected notes
*   Automatic timeout
*   Re-authentication required
*   Frontend: `protected_session.ts`
*   Backend: `protected_session.ts`

### Authentication

**Password Auth:**

*   PBKDF2 key derivation
*   Salt per installation
*   Hash verification

**OpenID Connect:**

*   External identity provider support
*   OAuth 2.0 flow
*   Configurable providers

**TOTP (2FA):**

*   Time-based one-time passwords
*   QR code setup
*   Backup codes

### Authorization

**Single-User Model:**

*   Desktop: single user (owner)
*   Server: single user per installation

**Share Notes:**

*   Public access without authentication
*   Separate Shaca cache
*   Read-only access

### CSRF Protection

**CSRF Tokens:**

*   Required for state-changing operations
*   Token in header or cookie
*   Validation middleware

### Input Sanitization

**XSS Prevention:**

*   DOMPurify for HTML sanitization
*   CKEditor content filtering
*   CSP headers

**SQL Injection:**

*   Parameterized queries only
*   Better-sqlite3 prepared statements
*   No string concatenation in SQL

### Dependency Security

**Vulnerability Scanning:**

*   Renovate bot for updates
*   npm audit integration
*   Override vulnerable sub-dependencies