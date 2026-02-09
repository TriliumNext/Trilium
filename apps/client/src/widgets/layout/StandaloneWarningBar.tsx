import { isMobile } from "../../services/utils";
import Admonition from "../react/Admonition";

export default function StandaloneWarningBar() {
    return (
        <div
            className="standalone-warning-bar"
            style={{
                contain: "none"
            }}
        >
            <Admonition
                type="caution"
                style={{
                    margin: 0,
                    fontSize: "0.8em"
                }}
            >
                {isMobile()
                    ? "Running Trilium standalone. Beware of data loss and other issues."
                    : "You are running Trilium in standalone mode. Some features are not available, and you may experience issues or data loss. Use the desktop application or self-hosted server for the best experience."
                }
            </Admonition>
        </div>
    );
}
