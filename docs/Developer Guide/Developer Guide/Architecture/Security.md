# Security
Trilium implements a **defense-in-depth security model** with multiple layers of protection for user data. The security architecture covers authentication, authorization, encryption, input sanitization, and secure communication.

## Security Principles

1.  **Data Privacy**: User data is protected at rest and in transit
2.  **Encryption**: Per-note encryption for sensitive content
3.  **Authentication**: Multiple authentication methods supported
4.  **Authorization**: Single-user model with granular protected sessions
5.  **Input Validation**: All user input sanitized
6.  **Secure Defaults**: Security features enabled by default
7.  **Transparency**: Open source allows security audits

## Threat Model

### Threats Considered

1.  **Unauthorized Access**
    *   Physical access to device
    *   Network eavesdropping
    *   Stolen credentials
    *   Session hijacking
2.  **Data Exfiltration**
    *   Malicious scripts
    *   XSS attacks
    *   SQL injection
    *   CSRF attacks
3.  **Data Corruption**
    *   Malicious modifications
    *   Database tampering
    *   Sync conflicts
4.  **Privacy Leaks**
    *   Unencrypted backups
    *   Search indexing
    *   Temporary files
    *   Memory dumps

### Out of Scope

*   Nation-state attackers
*   Zero-day vulnerabilities in dependencies
*   Hardware vulnerabilities (Spectre, Meltdown)
*   Physical access with unlimited time
*   Quantum computing attacks

## Authentication

### Password Authentication

**Implementation:** `apps/server/src/services/password.ts`

### TOTP (Two-Factor Authentication)

**Implementation:** `apps/server/src/routes/api/login.ts`

### OpenID Connect

**Implementation:** `apps/server/src/routes/api/login.ts`

**Supported Providers:**

*   Any OpenID Connect compatible provider
*   Google, GitHub, Auth0, etc.

**Flow:**

```typescript
// 1. Redirect to provider
GET /api/login/openid

// 2. Provider redirects back with code
GET /api/login/openid/callback?code=...

// 3. Exchange code for tokens
const tokens = await openidClient.callback(redirectUri, req.query)

// 4. Verify ID token
const claims = tokens.claims()

// 5. Create session
req.session.loggedIn = true
```

### Session Management

**Session Storage:** SQLite database (sessions table)

**Session Configuration:**

```typescript
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
        httpOnly: true,
        secure: isHttps,
        sameSite: 'lax'
    },
    store: new SqliteStore({
        db: db,
        table: 'sessions'
    })
}))
```

**Session Invalidation:**

*   Automatic timeout after inactivity
*   Manual logout clears session
*   Server restart invalidates all sessions (optional)

## Authorization

### Single-User Model

**Desktop:**

*   Single user (owner of device)
*   No multi-user support
*   Full access to all notes

**Server:**

*   Single user per installation
*   Authentication required for all operations
*   No user roles or permissions

### Protected Sessions

**Purpose:** Temporary access to encrypted (protected) notes

**Implementation:** `apps/server/src/services/protected_session.ts`

**Workflow:**

```typescript
// 1. User enters password for protected notes
POST /api/protected-session/enter
Body: { password: "protected-password" }

// 2. Derive encryption key
const protectedDataKey = deriveKey(password)

// 3. Verify password (decrypt known encrypted value)
const decrypted = decrypt(testValue, protectedDataKey)
if (decrypted === expectedValue) {
    // 4. Store in memory (not in session)
    protectedSessionHolder.setProtectedDataKey(protectedDataKey)
    
    // 5. Set timeout
    setTimeout(() => {
        protectedSessionHolder.clearProtectedDataKey()
    }, timeout)
}
```

**Protected Session Timeout:**

*   Default: 10 minutes (configurable)
*   Extends on activity
*   Cleared on browser close
*   Separate from main session

### API Authorization

**Internal API:**

*   Requires authenticated session
*   CSRF token validation
*   Same-origin policy

**ETAPI (External API):**

*   Token-based authentication
*   No session required
*   Rate limiting

## Encryption

### Note Encryption

**Encryption Algorithm:** AES-256-CBC

**Key Hierarchy:**

```
User Password
    ↓ (scrypt)
Data Key (for protected notes)
    ↓ (AES-128)
Protected Note Content
```

**Protected Note Metadata:**

*   Content IS encrypted
*   Type and MIME are NOT encrypted
*   Attributes are NOT encrypted

### Data Key Management

**Key Rotation:**

*   Not currently supported
*   Requires re-encrypting all protected notes

### Transport Encryption

**HTTPS:**

*   Recommended for server installations
*   TLS 1.2+ only
*   Strong cipher suites preferred
*   Certificate validation enabled

**Desktop:**

*   Local communication (no network)
*   No HTTPS required

### Backup Encryption

**Database Backups:**

*   Protected notes remain encrypted in backup
*   Backup file should be protected separately
*   Consider encrypting backup storage location

## Input Sanitization

### XSS Prevention

*   **HTML Sanitization**
*   **CKEditor Configuration:**
    
    ```
    // apps/client/src/widgets/type_widgets/text_type_widget.ts
    ClassicEditor.create(element, {
        // Restrict allowed content
        htmlSupport: {
            allow: [
                { name: /./, attributes: true, classes: true, styles: true }
            ],
            disallow: [
                { name: 'script' },
                { name: 'iframe', attributes: /^(?!src$).*/ }
            ]
        }
    })
    ```
*   Content Security Policy

### SQL Injection Prevention

**Parameterized Queries:**

```typescript
const notes = sql.getRows(
    'SELECT * FROM notes WHERE title = ?',
    [userInput]
)
```

**ORM Usage:**

```typescript
// Entity-based access prevents SQL injection
const note = becca.getNote(noteId)
note.title = userInput  // Sanitized by entity
note.save()  // Parameterized query
```

### CSRF Prevention

**CSRF Token Validation:**

Location: `apps/server/src/routes/csrf_protection.ts`

Stateless CSRF using [Double Submit Cookie Pattern](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#double-submit-cookie) via [`csrf-csrf`](https://github.com/Psifi-Solutions/csrf-csrf).

### File Upload Validation

**Validation:**

```typescript
// Validate file size
const maxSize = 100 * 1024 * 1024  // 100 MB
if (file.size > maxSize) {
    throw new Error('File too large')
}
```

## Network Security

### HTTPS Configuration

**Certificate Validation:**

*   Require valid certificates in production
*   Self-signed certificates allowed for development
*   Certificate pinning not implemented

### Rate Limiting

**Login Rate Limiting:**

```typescript
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,  // 10 failed attempts
    skipSuccessfulRequests: true
})

app.post('/api/login/password', loginLimiter, loginHandler)
```

## Data Security

### Secure Data Deletion

**Soft Delete:**

```typescript
// Mark as deleted (sync first)
note.isDeleted = 1
note.deleteId = generateUUID()
note.save()

// Entity change tracked for sync
addEntityChange('notes', noteId, note)
```

**Hard Delete (Erase):**

```typescript
// After sync completed
sql.execute('DELETE FROM notes WHERE noteId = ?', [noteId])
sql.execute('DELETE FROM branches WHERE noteId = ?', [noteId])
sql.execute('DELETE FROM attributes WHERE noteId = ?', [noteId])

// Mark entity change as erased
sql.execute('UPDATE entity_changes SET isErased = 1 WHERE entityId = ?', [noteId])
```

**Blob Cleanup:**

```typescript
// Find orphaned blobs (not referenced by any note/revision/attachment)
const orphanedBlobs = sql.getRows(`
    SELECT blobId FROM blobs
    WHERE blobId NOT IN (SELECT blobId FROM notes WHERE blobId IS NOT NULL)
      AND blobId NOT IN (SELECT blobId FROM revisions WHERE blobId IS NOT NULL)
      AND blobId NOT IN (SELECT blobId FROM attachments WHERE blobId IS NOT NULL)
`)

// Delete orphaned blobs
for (const blob of orphanedBlobs) {
    sql.execute('DELETE FROM blobs WHERE blobId = ?', [blob.blobId])
}
```

### Memory Security

**Protected Data in Memory:**

*   Protected data keys stored in memory only
*   Cleared on timeout
*   Not written to disk
*   Not in session storage

## Dependency Security

### Vulnerability Scanning

**Tools:**

*   Renovate bot - Automatic dependency updates
*   `pnpm audit` - Check for known vulnerabilities
*   GitHub Dependabot alerts

**Process:**

```
# Check for vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Manual review for breaking changes
npm audit fix --force
```

### Dependency Pinning

**package.json:**

```
{
  "dependencies": {
    "express": "4.18.2",  // Exact version
    "better-sqlite3": "^9.2.2"  // Compatible versions
  }
}
```

**pnpm Overrides:**

```
{
  "pnpm": {
    "overrides": {
      "lodash@<4.17.21": ">=4.17.21",  // Force minimum version
      "axios@<0.21.2": ">=0.21.2"
    }
  }
}
```

### Patch Management

**pnpm Patches:**

```
# Create patch
pnpm patch @ckeditor/ckeditor5

# Edit files in temporary directory
# ...

# Generate patch file
pnpm patch-commit /tmp/ckeditor5-patch

# Patch applied automatically on install
```

## Security Auditing

### Logs

**Security Events Logged:**

*   Login attempts (success/failure)
*   Protected session access
*   Password changes
*   ETAPI token usage
*   Failed CSRF validations

**Log Location:**

*   Desktop: Console output
*   Server: Log files or stdout

### Monitoring

**Metrics to Monitor:**

*   Failed login attempts
*   API error rates
*   Unusual database changes
*   Large exports/imports