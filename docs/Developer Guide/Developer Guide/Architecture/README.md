# README
## Trilium Architecture Documentation

This comprehensive guide documents the architecture of Trilium Notes, providing developers with detailed information about the system's core components, data flow, and design patterns.

## Table of Contents

1.  [Three-Layer Cache System](Three-Layer-Cache-System.md)
2.  [Entity System](Entity-System.md)
3.  [Widget-Based UI Architecture](Widget-Based-UI-Architecture.md)
4.  [API Architecture](API-Architecture.md)
5.  [Monorepo Structure](Monorepo-Structure.md)

## Overview

Trilium Notes is built as a TypeScript monorepo using NX, featuring a sophisticated architecture that balances performance, flexibility, and maintainability. The system is designed around several key architectural patterns:

*   **Three-layer caching system** for optimal performance across backend, frontend, and shared content
*   **Entity-based data model** supporting hierarchical note structures with multiple parent relationships
*   **Widget-based UI architecture** enabling modular and extensible interface components
*   **Multiple API layers** for internal operations, external integrations, and real-time synchronization
*   **Monorepo structure** facilitating code sharing and consistent development patterns

## Quick Start for Developers

If you're new to Trilium development, start with these sections:

1.  [Monorepo Structure](Monorepo-Structure.md) - Understand the project organization
2.  [Entity System](Entity-System.md) - Learn about the core data model
3.  [Three-Layer Cache System](Three-Layer-Cache-System.md) - Understand data flow and caching

For UI development, refer to:

*   [Widget-Based UI Architecture](Widget-Based-UI-Architecture.md)

For API integration, see:

*   [API Architecture](API-Architecture.md)

## Architecture Principles

### Performance First

*   Lazy loading of note content
*   Efficient caching at multiple layers
*   Optimized database queries with prepared statements

### Flexibility

*   Support for multiple note types
*   Extensible through scripting
*   Plugin architecture for UI widgets

### Data Integrity

*   Transactional database operations
*   Revision history for all changes
*   Synchronization conflict resolution

### Security

*   Per-note encryption
*   Protected sessions
*   API authentication tokens

## Development Workflow

1.  **Setup Development Environment**
    
    ```sh
    pnpm install
    pnpm run server:start
    ```
2.  **Make Changes**
    
    *   Backend changes in `apps/server/src/`
    *   Frontend changes in `apps/client/src/`
    *   Shared code in `packages/`
3.  **Test Your Changes**
    
    ```sh
    pnpm test:all
    pnpm nx run <project>:lint
    ```
4.  **Build for Production**
    
    ```sh
    pnpm nx build server
    pnpm nx build client
    ```

## Further Reading

*   [Development Environment Setup](#root/tFVKyUp99QEc)
*   [Adding a New Note Type](#root/6aV1LKciq0CF)
*   [Database Schema](#root/eZcnGfMUmic0)
*   [Script API Documentation](#root/7Pp4moCrBVzA)