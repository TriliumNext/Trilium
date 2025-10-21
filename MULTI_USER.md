# Multi-User Support for Trilium Notes

This document describes the multi-user functionality added to Trilium Notes.

## Overview

Trilium now supports multiple users with role-based access control. Each user has their own credentials and can be assigned different roles (Admin, User, or Viewer).

## Architecture

### Database Schema

Multi-user support extends the existing `user_data` table (introduced in migration v229 for OAuth support).

**Important Design Decisions:**

1. **Why `user_data` table?** eliandoran asked about using `user_info` table from MFA. We use `user_data` because it's the established table from OAuth migration (v229) with existing password hashing infrastructure.

2. **Why not Becca entities?** Users are NOT implemented as Becca entities because:
   - Becca entities are for **synchronized content** (notes, branches, attributes, etc.)
   - User authentication data should **never be synced** across instances for security
   - Each Trilium instance needs its own isolated user database
   - Syncing user credentials would create massive security risks
   
3. **Future sync support:** When multi-user sync is implemented, it will need:
   - Per-user sync credentials on each instance
   - User-to-user mappings across instances
   - Separate authentication from content synchronization
   - This is documented as a future enhancement

**user_data table fields:**
- `tmpID`: INTEGER primary key
- `username`: User's login name
- `email`: Optional email address
- `userIDVerificationHash`: Password hash (scrypt)
- `salt`: Password salt
- `derivedKey`: Key derivation salt
- `userIDEncryptedDataKey`: Encrypted data key (currently unused)
- `isSetup`: 'true' or 'false' string
- `role`: 'admin', 'user', or 'viewer'
- `isActive`: 1 (active) or 0 (inactive)
- `utcDateCreated`: Creation timestamp
- `utcDateModified`: Last modification timestamp

### User Roles

- **Admin**: Full access to all notes and user management
- **User**: Can create, read, update, and delete their own notes
- **Viewer**: Read-only access to their notes

### Migration (v234)

**Migration Triggering:** This migration runs automatically on next server start because the database version was updated to 234 in `app_info.ts`.

The migration automatically:
1. Extends the `user_data` table with role and status fields
2. Adds `userId` columns to notes, branches, etapi_tokens, and recent_notes tables
3. Creates a default admin user from existing single-user credentials
4. Associates all existing data with the admin user (tmpID=1)
5. Maintains backward compatibility with single-user installations

## Setup

### For New Installations

On first login, set a password as usual. This creates the default admin user.

### For Existing Installations

When you upgrade, the migration runs automatically:
1. Your existing password becomes the admin user's password
2. Username defaults to "admin"
3. All your existing notes remain accessible

### Creating Additional Users

After migration, you can create additional users via the REST API:

```bash
# Create a new user (requires admin privileges)
curl -X POST http://localhost:8080/api/users \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=YOUR_SESSION_COOKIE" \
  -d '{
    "username": "newuser",
    "email": "user@example.com",
    "password": "securepassword",
    "role": "user"
  }'
```

## API Endpoints

All endpoints require authentication. Most require admin privileges.

### List Users
```
GET /api/users
Query params: includeInactive=true (optional)
Requires: Admin
```

### Get User
```
GET /api/users/:userId
Requires: Admin or own user
```

### Create User
```
POST /api/users
Body: { username, email?, password, role? }
Requires: Admin
```

### Update User
```
PUT /api/users/:userId
Body: { email?, password?, isActive?, role? }
Requires: Admin (or own user for email/password only)
```

### Delete User
```
DELETE /api/users/:userId
Requires: Admin
Note: Soft delete (sets isActive=0)
```

### Get Current User
```
GET /api/users/current
Requires: Authentication
```

### Check Username Availability
```
GET /api/users/check-username?username=testuser
Requires: Authentication
```

## Login

### Single-User Mode
If only one user exists, login works as before (password-only).

### Multi-User Mode  
When multiple users exist:
1. Username field appears on login page
2. Enter username + password to authenticate
3. Session stores user ID and role

## Security

- Passwords are hashed using scrypt (N=16384, r=8, p=1)
- Each user has unique salt
- Sessions are maintained using express-session
- Users can only access their own notes (except admins)

## Backward Compatibility

- Single-user installations continue to work without changes
- No username field shown if only one user exists
- Existing password continues to work after migration
- All existing notes remain accessible

## Limitations

- No per-note sharing between users yet (planned for future)
- No user interface for user management (use API)
- Sync protocol not yet multi-user aware
- No user switching without logout

## Future Enhancements

1. **UI for User Management**: Add settings dialog for creating/managing users
2. **Note Sharing**: Implement per-note sharing with other users
3. **Sync Support**: Update sync protocol for multi-instance scenarios
4. **User Switching**: Allow switching users without logout
5. **Groups**: Add user groups for easier permission management
6. **Audit Log**: Track user actions for security

## Troubleshooting

### Can't log in after migration
- Try username "admin" with your existing password
- Check server logs for migration errors

### Want to reset admin password
1. Stop Trilium
2. Access document.db directly
3. Update the user_data table manually
4. Restart Trilium

### Want to disable multi-user
Not currently supported. Once migrated, single-user mode won't work if additional users exist.

## Technical Details

### Files Modified
- `apps/server/src/migrations/0234__multi_user_support.ts` - Migration
- `apps/server/src/services/user_management.ts` - User management service
- `apps/server/src/routes/api/users.ts` - REST API endpoints
- `apps/server/src/routes/login.ts` - Multi-user login logic
- `apps/server/src/services/auth.ts` - Authentication middleware
- `apps/server/src/express.d.ts` - Session type definitions
- `apps/server/src/assets/views/login.ejs` - Login page UI

### Testing
```bash
# Run tests
pnpm test

# Build
pnpm build

# Check TypeScript
pnpm --filter @triliumnext/server typecheck
```

## Contributing

When extending multi-user support:
1. Always test with both single-user and multi-user modes
2. Maintain backward compatibility
3. Update this documentation
4. Add tests for new functionality

## Support

For issues or questions:
- GitHub Issues: https://github.com/TriliumNext/Trilium/issues
- Discussions: https://github.com/orgs/TriliumNext/discussions
