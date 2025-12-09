import packageJson from "../../package.json" with { type: "json" };
import { isDev } from "./utils";

/**
 * The URL prefix for assets (e.g. `assets/v1.2.3`).
 */
export const assetUrlFragment = `assets/v${packageJson.version}`;

/**
 * Similar to the {@link assetUrlFragment}, but on dev mode it also contains the `/src` suffix.
 */
const assetPath = isDev ? assetUrlFragment + "/src" : assetUrlFragment;

export default assetPath;
