import "./UserAvatar.css";

import { getInitials } from "@triliumnext/commons";
import clsx from "clsx";

interface UserAvatarProps {
    username: string;
    /** The user's hue on the color wheel, from `getAvatarHues()`. */
    hue: number;
    className?: string;
}

/**
 * A circle with the user's initials, tinted by their hue. It is decoration beside the username,
 * which names the user, so assistive technology skips it. The size comes from
 * `--user-avatar-size`.
 */
export default function UserAvatar({ username, hue, className }: UserAvatarProps) {
    return (
        <span
            className={clsx("user-avatar", className)}
            aria-hidden="true"
            style={{ "--user-avatar-hue": hue }}
        >
            {getInitials(username)}
        </span>
    );
}
