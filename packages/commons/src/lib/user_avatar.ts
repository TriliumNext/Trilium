/** Where the first user's avatar sits on the color wheel, a blue. */
const FIRST_HUE = 210;
const GOLDEN_ANGLE = 137.508;

/** What {@link getAvatarHues} orders users by. */
export interface AvatarUser {
    userId: string;
    dateCreated: string;
}

/**
 * The avatar hue of each user, by `userId`: the users in the order they were added, each a golden
 * angle round the wheel from the one before, so the first few are always far apart and a new user
 * leaves everyone else's color alone.
 */
export function getAvatarHues(users: AvatarUser[]) {
    const ordered = [ ...users ].sort((a, b) => a.dateCreated.localeCompare(b.dateCreated) || a.userId.localeCompare(b.userId));
    return new Map(ordered.map((user, index) => [ user.userId, Math.round((FIRST_HUE + index * GOLDEN_ANGLE) % 360) ]));
}

/** Up to two letters for an avatar: the first of each of the first two words, or the first two. */
export function getInitials(username: string) {
    const words = username.trim().split(/[\s._-]+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
    return letters.toUpperCase();
}
