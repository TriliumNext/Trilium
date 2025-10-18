import rootPackageJson from '../../../package.json' with { type: "json" };
import { t } from './i18n';

export type App = "desktop" | "server";

export type Architecture = 'x64' | 'arm64';

export type Platform = "macos" | "windows" | "linux" | "pikapod" | "docker";

const version = rootPackageJson.version;

export interface DownloadInfo {
    recommended?: boolean;
    name: string;
    url?: string;
}

export interface DownloadMatrixEntry {
    title: Record<Architecture, string> | string;
    description: Record<Architecture, string> | string;
    downloads: Record<string, DownloadInfo>;
    helpUrl?: string;
    quickStartTitle?: string;
    quickStartCode?: string;
}

export interface RecommendedDownload {
    architecture: Architecture;
    platform: Platform;
    url: string;
    name: string;
}

type DownloadMatrix = Record<App, { [ P in Platform ]?: DownloadMatrixEntry }>;

// Keep compatibility info inline with https://github.com/electron/electron/blob/main/README.md#platform-support.
export const downloadMatrix: DownloadMatrix = {
    desktop: {
        windows: {
            title: {
                x64: t("download_helper_desktop_windows.title_x64"),
                arm64: t("download_helper_desktop_windows.title_arm64")
            },
            description: {
                x64: t("download_helper_desktop_windows.description_x64"),
                arm64: t("download_helper_desktop_windows.description_arm64"),
            },
            quickStartTitle: t("download_helper_desktop_windows.quick_start"),
            quickStartCode: "winget install TriliumNext.Notes",
            downloads: {
                exe: {
                    recommended: true,
                    name: t("download_helper_desktop_windows.download_exe")
                },
                zip: {
                    name: t("download_helper_desktop_windows.download_zip")
                },
                scoop: {
                    name: t("download_helper_desktop_windows.download_scoop"),
                    url: "https://scoop.sh/#/apps?q=trilium&id=7c08bc3c105b9ee5c00dd4245efdea0f091b8a5c"
                }
            }
        },
        linux: {
            title: {
                x64: t("download_helper_desktop_linux.title_x64"),
                arm64: t("download_helper_desktop_linux.title_arm64")
            },
            description: {
                x64: t("download_helper_desktop_linux.description_x64"),
                arm64: t("download_helper_desktop_linux.description_arm64"),
            },
            quickStartTitle: t("download_helper_desktop_linux.quick_start"),
            downloads: {
                deb: {
                    recommended: true,
                    name: t("download_helper_desktop_linux.download_deb")
                },
                rpm: {
                    recommended: true,
                    name: t("download_helper_desktop_linux.download_rpm")
                },
                flatpak: {
                    name: t("download_helper_desktop_linux.download_flatpak")
                },
                zip: {
                    name: t("download_helper_desktop_linux.download_zip")
                },
                nixpkgs: {
                    name: t("download_helper_desktop_linux.download_nixpkgs"),
                    url: "https://search.nixos.org/packages?query=trilium-next"
                },
                aur: {
                    name: t("download_helper_desktop_linux.download_aur"),
                    url: "https://aur.archlinux.org/packages/triliumnext-bin"
                }
            }
        },
        macos: {
            title: {
                x64: t("download_helper_desktop_macos.title_x64"),
                arm64: t("download_helper_desktop_macos.title_arm64")
            },
            description: {
                x64: t("download_helper_desktop_macos.description_x64"),
                arm64: t("download_helper_desktop_macos.description_arm64"),
            },
            quickStartTitle: t("download_helper_desktop_macos.quick_start"),
            quickStartCode: "brew install --cask trilium-notes",
            downloads: {
                dmg: {
                    recommended: true,
                    name: t("download_helper_desktop_macos.download_dmg")
                },
                homebrew: {
                    name: t("download_helper_desktop_macos.download_homebrew_cask"),
                    url: "https://formulae.brew.sh/cask/trilium-notes#default"
                },
                zip: {
                    name: t("download_helper_desktop_macos.download_zip")
                }
            }
        }
    },
    server: {
        docker: {
            title: t("download_helper_server_docker.title"),
            description: t("download_helper_server_docker.description"),
            helpUrl: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.html",
            quickStartCode: "docker pull triliumnext/trilium\ndocker run -p 8080:8080 -d ./data:/home/node/trilium-data triliumnext/trilium",
            downloads: {
                dockerhub: {
                    name: t("download_helper_server_docker.download_dockerhub"),
                    url: "https://hub.docker.com/r/triliumnext/trilium"
                },
                ghcr: {
                    name: t("download_helper_server_docker.download_ghcr"),
                    url: "https://github.com/TriliumNext/Trilium/pkgs/container/trilium"
                }
            }
        },
        linux: {
            title: t("download_helper_server_linux.title"),
            description: t("download_helper_server_linux.description"),
            helpUrl: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.html",
            downloads: {
                tarX64: {
                    recommended: true,
                    name: t("download_helper_server_linux.download_tar_x64"),
                    url: `https://github.com/TriliumNext/Trilium/releases/download/v${version}/TriliumNotes-Server-v${version}-linux-x64.tar.xz`,
                },
                tarArm64: {
                    recommended: true,
                    name: t("download_helper_server_linux.download_tar_arm64"),
                    url: `https://github.com/TriliumNext/Trilium/releases/download/v${version}/TriliumNotes-Server-v${version}-linux-arm64.tar.xz`
                },
                nixos: {
                    name: t("download_helper_server_linux.download_nixos"),
                    url: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/On%20NixOS"
                }
            }
        },
        pikapod: {
            title: t("download_helper_server_hosted.title"),
            description: t("download_helper_server_hosted.description"),
            downloads: {
                pikapod: {
                    recommended: true,
                    name: t("download_helper_server_hosted.download_pikapod"),
                    url: "https://www.pikapods.com/pods?run=trilium-next"
                },
                triliumcc: {
                    name: t("download_helper_server_hosted.download_triliumcc"),
                    url: "https://trilium.cc/"
                }
            }
        }
    }
};

export function buildDownloadUrl(app: App, platform: Platform, format: string, architecture: Architecture): string {
    if (app === "desktop") {
        return downloadMatrix.desktop[platform]?.downloads[format].url ??
            `https://github.com/TriliumNext/Trilium/releases/download/v${version}/TriliumNotes-v${version}-${platform}-${architecture}.${format}`;
    } else if (app === "server") {
        return downloadMatrix.server[platform]?.downloads[format].url ?? "#";
    } else {
        return "#";
    }
}

export async function getArchitecture(): Promise<Architecture | null> {
    if (typeof window === "undefined") return null;

    if (navigator.userAgentData) {
        const { architecture } = await navigator.userAgentData.getHighEntropyValues(["architecture"]);
        return architecture?.startsWith("arm") ? "arm64" : "x64";
    }

    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('arm64') || userAgent.includes('aarch64')) {
        return 'arm64';
    }

    return "x64";
}

export function getPlatform(): Platform | null {
    if (typeof window === "undefined") return null;

    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('macintosh') || userAgent.includes('mac os x')) {
        return "macos";
    } else if (userAgent.includes('windows') || userAgent.includes('win32')) {
        return "windows";
    } else {
        return "linux";
    }
}

export async function getRecommendedDownload(): Promise<RecommendedDownload | null> {
    if (typeof window === "undefined") return null;

    const architecture = await getArchitecture();
    const platform = getPlatform();
    if (!platform || !architecture) return null;

    const platformInfo = downloadMatrix.desktop[platform];
    if (!platformInfo) return null;

    const downloadInfo = platformInfo.downloads;
    const recommendedDownload = Object.entries(downloadInfo || {}).find(d => d[1].recommended);
    if (!recommendedDownload) return null;

    const format = recommendedDownload[0];
    const url = buildDownloadUrl("desktop", platform, format || 'zip', architecture);

    const platformTitle = platformInfo.title;
    const name = typeof platformTitle === "string" ? platformTitle : platformTitle[architecture] as string;

    return {
        architecture,
        platform,
        url,
        name
    }
}
