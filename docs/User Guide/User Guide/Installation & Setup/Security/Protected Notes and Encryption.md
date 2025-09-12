# Protected Notes and Encryption
Trilium provides robust encryption capabilities through its Protected Notes system, ensuring your sensitive information remains secure even if your database is compromised.

## Overview

Protected notes in Trilium use **AES-128-CBC encryption** with scrypt-based key derivation to protect sensitive content. The encryption is designed to be:

*   **Secure**: Uses industry-standard AES encryption with strong key derivation
*   **Selective**: Only notes marked as protected are encrypted
*   **Session-based**: Decrypted content remains accessible during a protected session
*   **Zero-knowledge**: The server never stores unencrypted protected content

## How Encryption Works

### Encryption Algorithm

*   **Cipher**: AES-128-CBC (Advanced Encryption Standard in Cipher Block Chaining mode)
*   **Key Derivation**: Scrypt with configurable parameters (N=16384, r=8, p=1)
*   **Initialization Vector**: 16-byte random IV generated for each encryption operation
*   **Integrity Protection**: SHA-1 digest (first 4 bytes) prepended to plaintext for tamper detection

### Key Management

1.  **Master Password**: User-provided password used for key derivation
2.  **Data Key**: 32-byte random key generated during setup, encrypted with password-derived key
3.  **Password-Derived Key**: Generated using scrypt from master password and salt
4.  **Session Key**: Data key loaded into memory during protected session

### Encryption Process

```
1. Generate random 16-byte IV
2. Compute SHA-1 digest of plaintext (use first 4 bytes)
3. Prepend digest to plaintext
4. Encrypt (digest + plaintext) using AES-128-CBC
5. Prepend IV to encrypted data
6. Encode result as Base64
```

### Decryption Process

```
1. Decode Base64 ciphertext
2. Extract IV (first 16 bytes) and encrypted data
3. Decrypt using AES-128-CBC with data key and IV
4. Extract digest (first 4 bytes) and plaintext
5. Verify integrity by comparing computed vs. stored digest
6. Return plaintext if verification succeeds
```

## Setting Up Protected Notes

### Initial Setup

1.  **Set Master Password**: Configure a strong password during initial setup
2.  **Create Protected Note**: Right-click a note and select "Toggle Protected Status"
3.  **Enter Protected Session**: Click the shield icon or use Ctrl+Shift+P

### Password Requirements

*   **Minimum Length**: 8 characters (recommended: 12+ characters)
*   **Complexity**: Use a mix of uppercase, lowercase, numbers, and symbols
*   **Uniqueness**: Don't reuse passwords from other services
*   **Storage**: Consider using a password manager for complex passwords

### Best Practices

1.  **Strong Passwords**: Use passphrases or generated passwords
2.  **Regular Changes**: Update passwords periodically
3.  **Secure Storage**: Store password recovery information securely
4.  **Backup Strategy**: Ensure encrypted backups are properly secured

## Protected Sessions

### Session Management

*   **Automatic Timeout**: Sessions expire after configurable timeout (default: 10 minutes)
*   **Manual Control**: Explicitly enter/exit protected sessions
*   **Activity Tracking**: Session timeout resets with each protected note access
*   **Multi-client**: Each client maintains its own protected session

### Session Lifecycle

1.  **Enter Session**: User enters master password
2.  **Key Derivation**: System derives data key from password
3.  **Session Active**: Protected content accessible in plaintext
4.  **Timeout/Logout**: Data key removed from memory
5.  **Protection Restored**: Content returns to encrypted state

### Configuration Options

Access via Options → Protected Session:

*   **Session Timeout**: Duration before automatic logout (seconds)
*   **Password Verification**: Enable/disable password strength requirements
*   **Recovery Options**: Configure password recovery mechanisms

## Performance Considerations

### Encryption Overhead

*   **CPU Impact**: Scrypt key derivation is intentionally CPU-intensive
*   **Memory Usage**: Minimal additional memory for encrypted content
*   **Storage Size**: Encrypted content is slightly larger due to Base64 encoding
*   **Network Transfer**: Encrypted notes transfer as Base64 strings

### Optimization Tips

1.  **Selective Protection**: Only encrypt truly sensitive notes
2.  **Session Management**: Keep sessions active during intensive work
3.  **Hardware Acceleration**: Modern CPUs provide AES acceleration
4.  **Batch Operations**: Group protected note operations when possible

## Security Considerations

### Threat Model

**Protected Against**:

*   Database theft or unauthorized access
*   Network interception (data at rest)
*   Server-side data breaches
*   Backup file compromise

**Not Protected Against**:

*   Keyloggers or screen capture malware
*   Physical access to unlocked device
*   Memory dumps during active session
*   Social engineering attacks

### Limitations

1.  **Note Titles**: Currently encrypted, may leak structural information
2.  **Metadata**: Creation dates, modification times remain unencrypted
3.  **Search Indexing**: Protected notes excluded from full-text search
4.  **Sync Conflicts**: May be harder to resolve for protected content

## Troubleshooting

### Common Issues

#### "Could not decrypt string" Error

**Causes**:

*   Incorrect password entered
*   Corrupted encrypted data
*   Database migration issues

**Solutions**:

1.  Verify password spelling and case sensitivity
2.  Check for active protected session
3.  Restart application and retry
4.  Restore from backup if corruption suspected

#### Protected Session Won't Start

**Causes**:

*   Password verification hash mismatch
*   Missing encryption salt
*   Database schema issues

**Solutions**:

1.  Check error logs for specific error messages
2.  Verify database integrity
3.  Restore from known good backup
4.  Contact support with error details

#### Performance Issues

**Symptoms**:

*   Slow password verification
*   Long delays entering protected session
*   High CPU usage during encryption

**Solutions**:

1.  Reduce scrypt parameters (advanced users only)
2.  Limit number of protected notes
3.  Upgrade hardware (more RAM/faster CPU)
4.  Close other resource-intensive applications

### Recovery Procedures

#### Password Recovery

If you forget your master password:

1.  **No Built-in Recovery**: Trilium cannot recover forgotten passwords
2.  **Backup Restoration**: Restore from backup with known password
3.  **Data Export**: Export unprotected content before password change
4.  **Complete Reset**: Last resort - lose all protected content

#### Data Recovery

For corrupted protected notes:

1.  **Verify Backup**: Check if backups contain uncorrupted data
2.  **Export/Import**: Try exporting and re-importing the note
3.  **Database Repair**: Use database repair tools if available
4.  **Professional Help**: Contact data recovery services for critical data

## Advanced Configuration

### Custom Encryption Parameters

**Warning**: Modifying encryption parameters requires advanced knowledge and may break compatibility.

For expert users, encryption parameters can be modified in the source code:

```typescript
// In my_scrypt.ts
const scryptParams = {
    N: 16384,  // CPU/memory cost parameter
    r: 8,      // Block size parameter  
    p: 1       // Parallelization parameter
};
```

### Integration with External Tools

Protected notes can be accessed programmatically:

```javascript
// Backend script example
const protectedNote = api.getNote('noteId');
if (protectedNote.isProtected) {
    // Content will be encrypted unless in protected session
    const content = protectedNote.getContent();
}
```

## Compliance and Auditing

### Encryption Standards

*   **Algorithm**: AES-128-CBC (FIPS 140-2 approved)
*   **Key Derivation**: Scrypt (RFC 7914)
*   **Random Generation**: Node.js crypto.randomBytes() (OS entropy)

### Audit Trail

*   Protected session entry/exit events logged
*   Encryption/decryption operations tracked
*   Password verification attempts recorded
*   Key derivation operations monitored

### Compliance Considerations

*   **GDPR**: Encryption provides data protection safeguards
*   **HIPAA**: AES encryption meets security requirements
*   **SOX**: Audit trails support compliance requirements
*   **PCI DSS**: Strong encryption protects sensitive data

## Migration and Backup

### Backup Strategies

1.  **Encrypted Backups**: Regular backups preserve encrypted state
2.  **Unencrypted Exports**: Export protected content during session
3.  **Key Management**: Securely store password recovery information
4.  **Testing**: Regularly test backup restoration procedures

### Migration Procedures

When moving to new installation:

1.  **Export Data**: Export all notes including protected content
2.  **Backup Database**: Create complete database backup
3.  **Transfer Files**: Move exported files to new installation
4.  **Import Data**: Import using same master password
5.  **Verify**: Confirm all protected content accessible

Remember: The security of protected notes ultimately depends on choosing a strong master password and following security best practices for your overall system.