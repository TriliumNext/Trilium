/**
 * What a backup is called when the user has not said.
 *
 * Shared because every platform writes the same kind of file for the same reason, and a user who
 * takes one from the desktop and one from a browser should not have to work out that the two are
 * the same thing. The name has to survive being a filename on every one of them, so it holds no
 * colons and nothing else Windows refuses.
 *
 * @param now the moment the backup was asked for, passed in so the caller decides what "now" is.
 */
export function defaultBackupName(now: Date): string {
    const stamp = (value: number) => String(value).padStart(2, "0");
    const date = [ now.getFullYear(), stamp(now.getMonth() + 1), stamp(now.getDate()) ].join("-");
    const time = [ stamp(now.getHours()), stamp(now.getMinutes()), stamp(now.getSeconds()) ].join("-");

    // Padded throughout, so a directory sorted by name is also sorted by date.
    return `Trilium data (${date} ${time})`;
}
