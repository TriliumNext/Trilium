## Summary

This PR implements comprehensive multi-user support for Trilium Notes, enabling multiple users to collaborate on the same Trilium instance with role-based access control while maintaining full backward compatibility with existing single-user installations.

## Changes

- Add database migration v234 for multi-user schema
- Implement users, roles, user_roles, and note_shares tables
- Add user management service with CRUD operations
- Implement role-based permission system (Admin/Editor/Reader)
- Add RESTful user management API endpoints
- Update login flow to support username + password authentication
- Maintain backward compatibility with legacy password-only login
- Create default admin user from existing credentials during migration
- Add session management for multi-user authentication
- Include TypeScript type definitions for Node.js globals

**Tests:** 948 passed | 17 skipped (965 total)  
**Build:** Successful (server and client)  
**TypeScript:** Zero errors

---

## Features Implemented

### 🔐 User Authentication
- **Username + Password authentication** for multi-user mode
- **Backward compatible** with legacy password-only authentication
- Automatic detection and fallback to single-user mode for existing installations
- Secure password hashing using scrypt (N=16384, r=8, p=1)

### 👥 User Management
- CRUD operations for user accounts
- User profile management
- Username availability checking
- Secure credential validation

### 🛡️ Role-Based Access Control (RBAC)
Three predefined roles with distinct permissions:

**Admin Role:**
- Full system access
- User management (create, update, delete users)
- Role assignment
- All note operations

**Editor Role:**
- Create, read, update, delete own notes
- Share notes with other users
- Edit shared notes (with permission)

**Reader Role:**
- Read-only access to own notes
- Read access to shared notes
- Cannot create or modify notes

### 📝 Note Sharing
- Share notes between users
- Granular sharing permissions (read/write)
- Note ownership tracking

### 🔄 Database Migration
- Migration v234 adds multi-user schema
- Creates `users`, `roles`, `user_roles`, and `note_shares` tables
- Adds `userId` column to `notes`, `branches`, `recent_notes`, and `etapi_tokens`
- **Automatic migration** of existing data to admin user
- Seeds default roles (Admin, Editor, Reader)
- Creates default admin user from existing credentials

### 🌐 RESTful API Endpoints

**User Management:**
- `POST /api/users` - Create new user (admin only)
- `GET /api/users` - List all users (admin only)
- `GET /api/users/:userId` - Get user details (admin only)
- `PUT /api/users/:userId` - Update user (admin only)
- `DELETE /api/users/:userId` - Delete user (admin only)
- `GET /api/users/current` - Get current user info
- `GET /api/users/username/available/:username` - Check username availability

## Implementation Details

### Files Added
- `apps/server/src/migrations/0234__multi_user_support.ts` - Database migration
- `apps/server/src/services/user_management.ts` - User management service
- `apps/server/src/routes/api/users.ts` - User API endpoints
- `apps/server/src/types/node-globals.d.ts` - Node.js type definitions

### Files Modified
- `apps/server/src/migrations/migrations.ts` - Registered migration v234
- `apps/server/src/routes/login.ts` - Multi-user login flow
- `apps/server/src/services/auth.ts` - Permission checks
- `apps/server/src/routes/routes.ts` - Registered user routes
- `apps/server/src/routes/assets.ts` - Test environment improvements
- `apps/server/src/express.d.ts` - Session type augmentation
- `apps/server/tsconfig.app.json` - TypeScript configuration
- `apps/server/package.json` - Added @types/node dependency

## Security Considerations

### Password Security
- Scrypt hashing with high work factors (N=16384, r=8, p=1)
- Random salt generation for each user
- Encrypted data keys for user-specific encryption

### Session Management
- Session-based authentication
- User context stored in session (userId, username, isAdmin)
- Session validation on protected routes

### Permission Enforcement
- Middleware-based permission checks
- Role-based access control
- Admin-only routes protected
- Note ownership validation

## Backward Compatibility

This implementation is **fully backward compatible**:
- Existing single-user installations continue to work unchanged
- Legacy password-only login flow preserved as fallback
- Migration automatically creates admin user from existing credentials
- No breaking changes to existing APIs
- All existing tests pass without modification

## Migration Guide

### For Fresh Installations
1. Install Trilium with this version
2. During setup, create admin username and password
3. Admin can create additional users via API

### For Existing Installations
1. Update to this version
2. Migration v234 runs automatically
3. Existing data is associated with default admin user
4. Admin username created from existing credentials
5. Continue using password-only login (legacy mode)
6. Optionally migrate to multi-user mode by creating new users

## API Example

### Create User (Admin only)
```bash
curl -X POST http://localhost:8080/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john_doe",
    "password": "secure_password",
    "email": "john@example.com",
    "fullName": "John Doe",
    "isActive": true
  }'
```

### Response
```json
{
  "userId": "abc123",
  "username": "john_doe",
  "email": "john@example.com",
  "fullName": "John Doe",
  "isActive": true,
  "dateCreated": "2025-10-21T10:00:00.000Z"
}
```

---

Closes #4956
