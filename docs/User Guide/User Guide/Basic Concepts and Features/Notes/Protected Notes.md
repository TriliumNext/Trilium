# Protected Notes
Trilium is designed to store a wide variety of data, including sensitive information such as personal journals, credentials, or confidential documents. To safeguard this type of content, Trilium offers the option to protect notes, which involves the following measures:

*   **Encryption:** Protected notes are encrypted using a key derived from your password. This ensures that without the correct password, protected notes remain indecipherable. Even if someone gains access to your Trilium [database](../../Advanced%20Usage/Database.md), they won't be able to read your encrypted notes.
*   **Time-limited access:** To access protected notes, you must first enter your password, which decrypts the note for reading and writing. However, after a specified period of inactivity (10 minutes by default), the note is unloaded from memory, requiring you to re-enter your password to access it again.
    *   The session timeout is extended automatically while you're interacting with the protected note, so if you're actively editing, the session remains open. However, if you switch to an unprotected note, the session timer starts, and the session expires after 10 minutes of inactivity unless you return to the protected notes.
*   **Protection scope:** Protected notes ensure the confidentiality of their content and partially their integrity. While unauthorized users cannot read or edit protected notes, they can still delete or move them outside of the protected session.

## Using Protected Notes

By default, notes are unprotected. To protect a note, simply click on the shield icon next to the note's title, as shown here:

![example animation of unlocking protected notes](Protected%20Notes_protecting-note.gif)

## What is Encrypted?

Trilium encrypts the data within protected notes but not their metadata. Specifically:

**Encrypted:**

*   Note title
*   Note content
*   Images
*   File attachments

**Not encrypted:**

*   Note structure (i.e., it remains visible that there are protected notes)
*   Metadata, such as the last modified date
*   [Attributes](../../Advanced%20Usage/Attributes.md)

## Encryption Details

The following steps outline how encryption and decryption work in Trilium:

1.  The user enters a password.
2.  The password is passed through the [scrypt](https://en.wikipedia.org/wiki/Scrypt) algorithm along with a "password verification" [salt](https://en.wikipedia.org/wiki/Salt_\(cryptography\)) to confirm that the password is correct.
3.  The password is then processed again through scrypt with an "encryption" salt, which generates a hash.
    *   Scrypt is used for [key stretching](https://en.wikipedia.org/wiki/Key_stretching) to make the password harder to guess.
4.  The generated hash is used to decrypt the actual _data encryption key_.
    *   The data encryption key is encrypted using [AES-128](https://en.wikipedia.org/wiki/Advanced_Encryption_Standard) with a random [IV](https://en.wikipedia.org/wiki/Initialization_vector).
    *   The data encryption key is randomly generated during the [database](../../Advanced%20Usage/Database.md) initialization and remains constant throughout the document’s lifetime. When the password is changed, only this key is re-encrypted.
5.  The data encryption key is then used to decrypt the actual content of the note, including its title and body.
    *   The encryption algorithm used is AES-128 with [CBC mode](https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation), where a unique IV is generated for each encryption operation and stored with the cipher text.

## Sharing Protected Notes

Protected notes cannot be shared in the same way as regular notes. Their encryption ensures that only authorized users with the correct password can access them.