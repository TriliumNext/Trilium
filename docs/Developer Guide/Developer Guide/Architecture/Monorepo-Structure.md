# Monorepo-Structure
## Monorepo Structure

Trilium is organized as a TypeScript monorepo using NX, facilitating code sharing, consistent tooling, and efficient build processes. This document provides a comprehensive overview of the project structure, build system, and development workflow.

## Project Organization

```
TriliumNext/Trilium/
├── apps/                      # Runnable applications
│   ├── client/               # Frontend web application
│   ├── server/               # Node.js backend server
│   ├── desktop/              # Electron desktop application
│   ├── web-clipper/          # Browser extension
│   ├── db-compare/           # Database comparison tool
│   ├── dump-db/              # Database dump utility
│   └── edit-docs/            # Documentation editor
├── packages/                  # Shared libraries
│   ├── commons/              # Shared interfaces and utilities
│   ├── ckeditor5/            # Rich text editor
│   ├── codemirror/           # Code editor
│   ├── highlightjs/          # Syntax highlighting
│   ├── ckeditor5-admonition/ # CKEditor plugin
│   ├── ckeditor5-footnotes/  # CKEditor plugin
│   ├── ckeditor5-math/       # CKEditor plugin
│   └── ckeditor5-mermaid/    # CKEditor plugin
├── docs/                      # Documentation
├── nx.json                    # NX workspace configuration
├── package.json              # Root package configuration
├── pnpm-workspace.yaml       # PNPM workspace configuration
└── tsconfig.base.json        # Base TypeScript configuration
```

## Applications

### Client (`/apps/client`)

The frontend application shared by both server and desktop versions.

```
apps/client/
├── src/
│   ├── components/         # Core UI components
│   ├── entities/           # Frontend entities (FNote, FBranch, etc.)
│   ├── services/           # Business logic and API calls
│   ├── widgets/            # UI widgets system
│   │   ├── type_widgets/   # Note type specific widgets
│   │   ├── dialogs/        # Dialog components
│   │   └── panels/         # Panel widgets
│   ├── public/
│   │   ├── fonts/          # Font assets
│   │   ├── images/         # Image assets
│   │   └── libraries/      # Third-party libraries
│   └── desktop.ts          # Desktop entry point
├── package.json
├── project.json            # NX project configuration
└── vite.config.ts          # Vite build configuration
```

#### Key Files

*   `desktop.ts` - Main application initialization
*   `services/froca.ts` - Frontend cache implementation
*   `widgets/basic_widget.ts` - Base widget class
*   `services/server.ts` - API communication layer

### Server (`/apps/server`)

The Node.js backend providing API, database, and business logic.

```
apps/server/
├── src/
│   ├── becca/              # Backend cache system
│   │   ├── entities/       # Core entities (BNote, BBranch, etc.)
│   │   └── becca.ts        # Cache interface
│   ├── routes/             # Express routes
│   │   ├── api/            # Internal API endpoints
│   │   └── pages/          # HTML page routes
│   ├── etapi/              # External API
│   ├── services/           # Business services
│   ├── share/              # Note sharing functionality
│   │   └── shaca/          # Share cache
│   ├── migrations/         # Database migrations
│   ├── assets/
│   │   ├── db/             # Database schema
│   │   └── doc_notes/      # Documentation notes
│   └── main.ts             # Server entry point
├── package.json
├── project.json
└── webpack.config.js       # Webpack configuration
```

#### Key Services

*   `services/sql.ts` - Database access layer
*   `services/sync.ts` - Synchronization logic
*   `services/ws.ts` - WebSocket server
*   `services/protected_session.ts` - Encryption handling

### Desktop (`/apps/desktop`)

Electron wrapper for the desktop application.

```
apps/desktop/
├── src/
│   ├── main.ts             # Electron main process
│   ├── preload.ts          # Preload script
│   ├── services/           # Desktop-specific services
│   └── utils/              # Desktop utilities
├── resources/              # Desktop resources (icons, etc.)
├── package.json
└── electron-builder.yml    # Electron Builder configuration
```

### Web Clipper (`/apps/web-clipper`)

Browser extension for saving web content to Trilium.

```
apps/web-clipper/
├── src/
│   ├── background.js       # Background script
│   ├── content.js          # Content script
│   ├── popup/              # Extension popup
│   └── options/            # Extension options
├── manifest.json           # Extension manifest
└── package.json
```

## Packages

### Commons (`/packages/commons`)

Shared TypeScript interfaces and utilities used across applications.

```typescript
// packages/commons/src/types.ts
export interface NoteRow {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    isProtected: boolean;
    dateCreated: string;
    dateModified: string;
}

export interface BranchRow {
    branchId: string;
    noteId: string;
    parentNoteId: string;
    notePosition: number;
    prefix: string;
    isExpanded: boolean;
}
```

### CKEditor5 (`/packages/ckeditor5`)

Custom CKEditor5 build with Trilium-specific plugins.

```
packages/ckeditor5/
├── src/
│   ├── ckeditor.ts         # Editor configuration
│   ├── plugins.ts          # Plugin registration
│   └── trilium/            # Custom plugins
├── theme/                  # Editor themes
└── package.json
```

#### Custom Plugins

*   **Admonition**: Note boxes with icons
*   **Footnotes**: Reference footnotes
*   **Math**: LaTeX equation rendering
*   **Mermaid**: Diagram integration

### CodeMirror (`/packages/codemirror`)

Code editor customizations for the code note type.

```typescript
// packages/codemirror/src/index.ts
export function createCodeMirror(element: HTMLElement, options: CodeMirrorOptions) {
    return CodeMirror(element, {
        ...defaultOptions,
        ...options,
        // Trilium-specific customizations
    });
}
```

## Build System

### NX Configuration

**`nx.json`**

```json
{
  "tasksRunnerOptions": {
    "default": {
      "runner": "nx/tasks-runners/default",
      "options": {
        "cacheableOperations": ["build", "test", "lint"],
        "parallel": 3
      }
    }
  },
  "targetDefaults": {
    "build": {
      "dependsOn": ["^build"],
      "cache": true
    },
    "test": {
      "cache": true
    }
  }
}
```

### Project Configuration

Each application and package has a `project.json` defining its targets:

```json
{
  "name": "server",
  "targets": {
    "build": {
      "executor": "@nx/webpack:webpack",
      "options": {
        "outputPath": "dist/apps/server",
        "main": "apps/server/src/main.ts",
        "tsConfig": "apps/server/tsconfig.app.json"
      }
    },
    "serve": {
      "executor": "@nx/node:node",
      "options": {
        "buildTarget": "server:build"
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "apps/server/jest.config.ts"
      }
    }
  }
}
```

### Build Commands

```sh
# Build specific project
pnpm nx build server
pnpm nx build client

# Build all projects
pnpm nx run-many --target=build --all

# Build with dependencies
pnpm nx build server --with-deps

# Production build
pnpm nx build server --configuration=production
```

## Development Workflow

### Initial Setup

```sh
# Install dependencies
pnpm install

# Enable corepack for pnpm
corepack enable

# Build all packages
pnpm nx run-many --target=build --all
```

### Development Commands

```sh
# Start development server
pnpm run server:start
# or
pnpm nx run server:serve

# Start desktop app
pnpm nx run desktop:serve

# Run client dev server
pnpm nx run client:serve

# Watch mode for packages
pnpm nx run commons:build --watch
```

### Testing

```sh
# Run all tests
pnpm test:all

# Run tests for specific project
pnpm nx test server
pnpm nx test client

# Run tests in watch mode
pnpm nx test server --watch

# Generate coverage
pnpm nx test server --coverage
```

### Linting and Type Checking

```sh
# Lint specific project
pnpm nx lint server

# Type check
pnpm nx run server:typecheck

# Lint all projects
pnpm nx run-many --target=lint --all

# Fix lint issues
pnpm nx lint server --fix
```

## Dependency Management

### Package Dependencies

Dependencies are managed at both root and project levels:

```json
// Root package.json - shared dev dependencies
{
  "devDependencies": {
    "@nx/workspace": "^17.0.0",
    "typescript": "^5.0.0",
    "eslint": "^8.0.0"
  }
}

// Project package.json - project-specific dependencies
{
  "dependencies": {
    "express": "^4.18.0",
    "better-sqlite3": "^9.0.0"
  }
}
```

### Adding Dependencies

```sh
# Add to root
pnpm add -D typescript

# Add to specific project
pnpm add express --filter server

# Add to multiple projects
pnpm add lodash --filter server --filter client
```

### Workspace References

Internal packages are referenced using workspace protocol:

```json
{
  "dependencies": {
    "@triliumnext/commons": "workspace:*"
  }
}
```

## TypeScript Configuration

### Base Configuration

**`tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "rootDir": ".",
    "sourceMap": true,
    "declaration": false,
    "moduleResolution": "node",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "dom"],
    "skipLibCheck": true,
    "skipDefaultLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@triliumnext/commons": ["packages/commons/src/index.ts"]
    }
  }
}
```

### Project-Specific Configuration

```json
// apps/server/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.spec.ts"]
}
```

## Build Optimization

### NX Cloud

```sh
# Enable NX Cloud for distributed caching
pnpm nx connect-to-nx-cloud
```

### Affected Commands

```sh
# Build only affected projects
pnpm nx affected:build --base=main

# Test only affected projects
pnpm nx affected:test --base=main

# Lint only affected projects
pnpm nx affected:lint --base=main
```

### Build Caching

NX caches build outputs to speed up subsequent builds:

```sh
# Clear cache
pnpm nx reset

# Run with cache disabled
pnpm nx build server --skip-nx-cache

# See cache statistics
pnpm nx report
```

## Production Builds

### Building for Production

```sh
# Build server for production
pnpm nx build server --configuration=production

# Build client with optimization
pnpm nx build client --configuration=production

# Build desktop app
pnpm nx build desktop --configuration=production
pnpm electron:build  # Creates distributables
```

### Docker Build

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm nx build server --configuration=production

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist/apps/server ./
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "main.js"]
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: CI

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
          
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'
          
      - run: pnpm install --frozen-lockfile
      
      - run: pnpm nx affected:lint --base=origin/main
      
      - run: pnpm nx affected:test --base=origin/main
      
      - run: pnpm nx affected:build --base=origin/main
```

## Troubleshooting

### Common Issues

1.  **Build Cache Issues**
    
    ```sh
    # Clear NX cache
    pnpm nx reset
    
    # Clear node_modules and reinstall
    rm -rf node_modules
    pnpm install
    ```
2.  **Dependency Version Conflicts**
    
    ```sh
    # Check for duplicate packages
    pnpm list --depth=0
    
    # Update all dependencies
    pnpm update --recursive
    ```
3.  **TypeScript Path Resolution**
    
    ```sh
    # Verify TypeScript paths
    pnpm nx run server:typecheck --traceResolution
    ```

### Debug Commands

```sh
# Show project graph
pnpm nx graph

# Show project dependencies
pnpm nx print-affected --type=app --select=projects

# Verbose output
pnpm nx build server --verbose

# Profile build performance
pnpm nx build server --profile
```

## Best Practices

### Project Structure

1.  **Keep packages focused**: Each package should have a single, clear purpose
2.  **Minimize circular dependencies**: Use dependency graph to identify issues
3.  **Share common code**: Extract shared logic to packages/commons

### Development

1.  **Use NX generators**: Generate consistent code structure
2.  **Leverage caching**: Don't skip-nx-cache unless debugging
3.  **Run affected commands**: Save time by only building/testing changed code

### Testing

1.  **Colocate tests**: Keep test files next to source files
2.  **Use workspace scripts**: Define common scripts in root package.json
3.  **Parallel execution**: Use `--parallel` flag for faster execution

## Related Documentation

*   [Environment Setup](#root/tFVKyUp99QEc) - Development environment setup
*   [Project Structure](#root/NurKhC1Zq1CN) - Detailed project structure
*   [Build Information](#root/m5GSI5gIyqs5) - Build details