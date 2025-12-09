import assetPath from "./asset_path.js";
import { isDev } from "./utils.js";

export default isDev ? assetPath : assetPath + "/src";
