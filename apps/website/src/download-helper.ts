import rootPackageJson from '../../../package.json' with { type: "json" };

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
                x64: "Windows 64-bit",
                arm64: "Windows on ARM"
            },
            description: {
                x64: "Compatible with Intel or AMD devices running Windows 10 and 11.",
                arm64: "Compatible with ARM devices (e.g. with Qualcomm Snapdragon).",
            },
            quickStartTitle: "To install via Winget:",
            quickStartCode: "winget install TriliumNext.Notes",
            downloads: {
                exe: {
                    recommended: true,
                    name: "Download Installer (.exe)"
                },
                zip: {
                    name: "Portable (.zip)"
                },
                scoop: {
                    name: "Scoop",
                    url: "https://scoop.sh/#/apps?q=trilium&id=7c08bc3c105b9ee5c00dd4245efdea0f091b8a5c"
                }
            }
        },
        linux: {
            title: {
                x64: "Linux 64-bit",
                arm64: "Linux on ARM"
            },
            description: {
                x64: "For most Linux distributions, compatible with x86_64 architecture.",
                arm64: "For ARM-based Linux distributions, compatible with aarch64 architecture.",
            },
            quickStartTitle: "Select an appropriate package format, depending on your distribution:",
            downloads: {
                deb: {
                    recommended: true,
                    name: ".deb"
                },
                rpm: {
                    recommended: true,
                    name: ".rpm"
                },
                flatpak: {
                    name: ".flatpak"
                },
                zip: {
                    name: "Portable (.zip)"
                },
                nixpkgs: {
                    name: "nixpkgs",
                    url: "https://search.nixos.org/packages?query=trilium-next"
                },
                aur: {
                    name: "AUR",
                    url: "https://aur.archlinux.org/packages/triliumnext-bin"
                }
            }
        },
        macos: {
            title: {
                x64: "macOS for Intel",
                arm64: "macOS for Apple Silicon"
            },
            description: {
                x64: "For Intel-based Macs running macOS Big Sur or later.",
                arm64: "For Apple Silicon Macs such as those with M1 and M2 chips.",
            },
            quickStartTitle: "To install via Homebrew:",
            quickStartCode: "brew install --cask trilium-notes",
            downloads: {
                dmg: {
                    recommended: true,
                    name: "Download Installer (.dmg)"
                },
                homebrew: {
                    name: "Homebrew Cask",
                    url: "https://formulae.brew.sh/cask/trilium-notes#default"
                },
                zip: {
                    name: "Portable (.zip)"
                }
            }
        }
    },
    server: {
        docker: {
            title: "Self-hosted using Docker",
            description: "Easily deploy on Windows, Linux or macOS using a Docker container.",
            helpUrl: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.html",
            quickStartCode: "docker pull triliumnext/trilium\ndocker run -p 8080:8080 -d ./data:/home/node/trilium-data triliumnext/trilium",
            downloads: {
                dockerhub: {
                    name: "Docker Hub",
                    url: "https://hub.docker.com/r/triliumnext/trilium"
                },
                ghcr: {
                    name: "ghcr.io",
                    url: "https://github.com/TriliumNext/Trilium/pkgs/container/trilium"
                }
            }
        },
        linux: {
            title: "Self-hosted on Linux",
            description: "Deploy Trilium Notes on your own server or VPS, compatible with most distributions.",
            helpUrl: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.html",
            downloads: {
                tarX64: {
                    recommended: true,
                    name: "x64 (.tar.xz)",
                    url: `https://github.com/TriliumNext/Trilium/releases/download/v${version}/TriliumNotes-Server-v${version}-linux-x64.tar.xz`,
                },
                tarArm64: {
                    recommended: true,
                    name: "ARM (.tar.xz)",
                    url: `https://github.com/TriliumNext/Trilium/releases/download/v${version}/TriliumNotes-Server-v${version}-linux-arm64.tar.xz`
                },
                nixos: {
                    name: "NixOS module",
                    url: "https://docs.triliumnotes.org/User%20Guide/User%20Guide/Installation%20&%20Setup/Server%20Installation/1.%20Installing%20the%20server/On%20NixOS"
                }
            }
        },
        pikapod: {
            title: "Paid hosting",
            description: "Trilium Notes hosted on PikaPods, a paid service for easy access and management. Not directly affiliated with the Trilium team.",
            downloads: {
                pikapod: {
                    recommended: true,
                    name: "Set up on PikaPods",
                    url: "https://www.pikapods.com/pods?run=trilium-next"
                },
                triliumcc: {
                    name: "Alternatively see trilium.cc",
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
