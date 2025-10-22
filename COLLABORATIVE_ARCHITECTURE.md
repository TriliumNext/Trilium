# Collaborative Multi-User Architecture

## Overview

This implementation provides a **collaborative multi-user system** where users can:
- Share notes with other users or groups
- Set granular permissions (read, write, admin) on notes
- Sync only notes they have access to
- Collaborate on shared notes in real-time

## Architecture Design

### Database Schema

#### 1. **users** table
Stores user accounts for authentication.

```sql
CREATE TABLE users (
    userId INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    passwordHash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    isActive INTEGER DEFAULT 1,
    utcDateCreated TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    lastLoginAt TEXT
)
```

#### 2. **groups** table
Allows organizing users into groups for easier permission management.

```sql
CREATE TABLE groups (
    groupId INTEGER PRIMARY KEY AUTOINCREMENT,
    groupName TEXT NOT NULL UNIQUE,
    description TEXT,
    createdBy INTEGER NOT NULL,
    utcDateCreated TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    FOREIGN KEY (createdBy) REFERENCES users(userId)
)
```

#### 3. **group_members** table
Many-to-many relationship between users and groups.

```sql
CREATE TABLE group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    addedBy INTEGER NOT NULL,
    utcDateAdded TEXT NOT NULL,
    UNIQUE(groupId, userId),
    FOREIGN KEY (groupId) REFERENCES groups(groupId),
    FOREIGN KEY (userId) REFERENCES users(userId)
)
```

#### 4. **note_ownership** table
Tracks the owner/creator of each note.

```sql
CREATE TABLE note_ownership (
    noteId TEXT PRIMARY KEY,
    ownerId INTEGER NOT NULL,
    utcDateCreated TEXT NOT NULL,
    FOREIGN KEY (noteId) REFERENCES notes(noteId),
    FOREIGN KEY (ownerId) REFERENCES users(userId)
)
```

#### 5. **note_permissions** table
Granular access control for notes.

```sql
CREATE TABLE note_permissions (
    permissionId INTEGER PRIMARY KEY AUTOINCREMENT,
    noteId TEXT NOT NULL,
    granteeType TEXT NOT NULL CHECK(granteeType IN ('user', 'group')),
    granteeId INTEGER NOT NULL,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'write', 'admin')),
    grantedBy INTEGER NOT NULL,
    utcDateGranted TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    UNIQUE(noteId, granteeType, granteeId),
    FOREIGN KEY (noteId) REFERENCES notes(noteId),
    FOREIGN KEY (grantedBy) REFERENCES users(userId)
)
```

## Permission Model

### Permission Levels

1. **read**: Can view note and its content
2. **write**: Can edit note content and attributes (includes read)
3. **admin**: Can edit, delete, and share note with others (includes write + read)

### Permission Resolution Rules

1. **Owner**: Note owner has implicit `admin` permission
2. **Direct vs Group**: Direct user permissions override group permissions
3. **Highest Wins**: If user has multiple permissions (through different groups), the highest level applies
4. **Inheritance**: Users inherit permissions from all groups they belong to

### Permission Checks

```typescript
// Check if user can read a note
permissions.checkNoteAccess(userId, noteId, 'read')

// Check if user can edit a note
permissions.checkNoteAccess(userId, noteId, 'write')

// Check if user can share/delete a note
permissions.checkNoteAccess(userId, noteId, 'admin')
```

## Services

### 1. permissions.ts
Core permission checking and management.

**Key Functions:**
- `checkNoteAccess(userId, noteId, permission)` - Check if user has required permission
- `getUserAccessibleNotes(userId)` - Get all notes user can access
- `getUserNotePermissions(userId)` - Get permission map for sync filtering
- `grantPermission(noteId, granteeType, granteeId, permission, grantedBy)` - Share a note
- `revokePermission(noteId, granteeType, granteeId)` - Unshare a note
- `filterEntityChangesForUser(userId, entityChanges)` - Filter sync data by permissions

### 2. group_management.ts
Group creation and membership management.

**Key Functions:**
- `createGroup(groupName, description, createdBy)` - Create new group
- `addUserToGroup(groupId, userId, addedBy)` - Add user to group
- `removeUserFromGroup(groupId, userId)` - Remove user from group
- `getGroupWithMembers(groupId)` - Get group details with member list
- `getUserGroups(userId)` - Get all groups a user belongs to

### 3. user_management_collaborative.ts
User authentication and account management.

**Key Functions:**
- `createUser(username, password, email, role)` - Create new user account
- `validateCredentials(username, password)` - Authenticate user login
- `changePassword(userId, newPassword)` - Update user password
- `getAllUsers()` - List all users
- `isAdmin(userId)` - Check if user is admin

## Sync Integration

### Permission-Aware Sync

The sync mechanism is modified to filter entity changes based on user permissions:

```typescript
// In sync route (routes/api/sync.ts)
const userId = req.session.userId; // From authenticated session
const accessibleNotes = permissions.getUserAccessibleNotes(userId);

// Filter entity changes
const filteredChanges = entityChanges.filter(ec => {
    if (ec.entityName === 'notes') {
        return accessibleNotes.includes(ec.entityId);
    }
    if (ec.entityName === 'branches' || ec.entityName === 'attributes') {
        // Check if related note is accessible
        const noteId = getNoteIdForEntity(ec);
        return noteId && accessibleNotes.includes(noteId);
    }
    return true; // Allow non-note entities
});
```

### Sync Flow

1. **Pull Changes** (Server → Client)
   - Server queries entity_changes table
   - Filters changes by user's accessible notes
   - Returns only changes for notes user has permission to access

2. **Push Changes** (Client → Server)
   - Client sends entity changes
   - Server validates user has write/admin permission
   - Rejects changes to notes user doesn't have access to
   - Applies valid changes to database

## API Routes

### User Management
- `POST /api/users` - Create new user (admin only)
- `GET /api/users` - List all users (admin only)
- `GET /api/users/:userId` - Get user details
- `PUT /api/users/:userId` - Update user
- `DELETE /api/users/:userId` - Delete user (admin only)
- `POST /api/users/:userId/change-password` - Change password

### Group Management
- `POST /api/groups` - Create new group
- `GET /api/groups` - List all groups
- `GET /api/groups/:groupId` - Get group with members
- `PUT /api/groups/:groupId` - Update group
- `DELETE /api/groups/:groupId` - Delete group
- `POST /api/groups/:groupId/members` - Add user to group
- `DELETE /api/groups/:groupId/members/:userId` - Remove user from group

### Permission Management
- `GET /api/notes/:noteId/permissions` - Get note permissions
- `POST /api/notes/:noteId/share` - Share note with user/group
- `DELETE /api/notes/:noteId/permissions/:permissionId` - Revoke permission
- `GET /api/notes/accessible` - Get all accessible notes for current user

## Usage Examples

### Sharing a Note

```typescript
// Alice (userId=1) shares "Project A" note with Bob (userId=2) with write permission
permissions.grantPermission('projectANoteId', 'user', 2, 'write', 1);

// Alice shares "Project A" with "Team Alpha" group (groupId=5) with read permission
permissions.grantPermission('projectANoteId', 'group', 5, 'read', 1);
```

### Checking Access

```typescript
// Check if Bob can edit the note
const canEdit = permissions.checkNoteAccess(2, 'projectANoteId', 'write'); // true

// Check if member of Team Alpha can edit (they have read permission)
const canMemberEdit = permissions.checkNoteAccess(3, 'projectANoteId', 'write'); // false
```

### Syncing as User

```typescript
// Bob syncs his local instance
// Server automatically filters to only send notes Bob has access to:
// - Notes Bob owns
// - Notes explicitly shared with Bob
// - Notes shared with groups Bob belongs to
```

## Security Considerations

1. **Password Security**: Uses scrypt with secure parameters for password hashing
2. **Timing Attack Protection**: Uses timingSafeEqual for password comparison
3. **SQL Injection**: All queries use parameterized statements
4. **Session Management**: Requires authenticated session for all operations
5. **Permission Checks**: Every operation validates user permissions
6. **Admin Operations**: Critical operations (user management) require admin role

## Migration from Isolated Model

The previous implementation used isolated users (each user had their own separate notes). This has been completely replaced with the collaborative model:

**Old Approach (Isolated)**:
- Each user had their own copy of all data
- No sharing between users
- Sync didn't work between users

**New Approach (Collaborative)**:
- Single database with all notes
- Users share specific notes via permissions
- Sync works across all users with permission filtering
- Owner-based access control

## Default Configuration

- **Default Admin**: username=`admin`, password=`admin123` (must be changed on first login)
- **Default Group**: "All Users" group automatically created
- **Existing Notes**: All existing notes owned by userId=1 (admin)

## Future Enhancements

1. **Permission Inheritance**: Inherit permissions from parent notes
2. **Audit Logging**: Track who accessed/modified what
3. **Notification System**: Notify users when notes are shared with them
4. **Collaborative Editing**: Real-time collaborative editing with conflict resolution
5. **Advanced Permissions**: Add custom permission levels, time-limited access
6. **API Keys**: Per-user API keys for programmatic access

## Testing

See comprehensive test suite in `/apps/server/src/test/collaborative_multi_user.test.ts` for:
- Permission resolution
- Sync filtering
- Group management
- Edge cases and security
