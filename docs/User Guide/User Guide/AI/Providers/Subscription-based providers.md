# Subscription-based providers
Some cloud providers offer a subscription, which has a fixed monthly fee instead of pay-per-use (unlike the API keys).

In a nutshell, subscription-based providers work by either reusing your existing CLI tools (e.g. Claude Code, GitHub Copilot via ACP) whereas some require installing the ACP server manually (e.g. Google Antigravity). Because they require something to be installed on your device, these providers are not available on Mobile (Android or iOS) or standalone mode.

See also the dedicated <a class="reference-link" href="../Privacy.md">Privacy</a> section to better understand what data is being sent to a cloud provider.

## Claude Code

To use a subscription:

1.  First, Claude Code needs to be installed on the machine that runs Trilium. So for a <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a>, Claude needs to be installed locally and for a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> accessed via a browser, Claude needs to be installed on the server.
2.  Claude Code must already be authenticated. To do so, run `claude` in a terminal once, type `/login` and follow the instructions.
3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the Claude Code provider.

Trilium will identify your Claude Code binary in this order:

*   By looking for a `TRILIUM_CLAUDE_CODE_PATH` environment variable pointing to the Claude binary. This allows overriding the path if needed.
*   By looking for `claude` in your PATH, generally works in most circumstances.
*   By asking your login shell for its `PATH` which lets a desktop install find a CLI installed through `nvm`, `fnm`, `asdf` or Homebrew, since a GUI-launched app doesn't inherit your terminal's environment.

After your provider is set up, you'll benefit from the same features as an API key (note tools, web search, extended thinking, image/PDF attachments, streaming).

> [!NOTE]
> Trilium intentionally uses your Claude Code binary in order not to have to package a ~250 MB client with it, but this comes at a cost: there is a small risk for a version incompatibility, if the version installed locally doesn't match the one expected by Trilium. Generally it's best to keep both Claude Code and Trilium updated to the latest version.

## GitHub Copilot

> [!NOTE]
> This subscription-based provider is still in beta. It is safe to use (won't use additional funds and respects the terms of use), but you might experience small issues. Consider <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

GitHub Copilot gives access to the models of your GitHub Copilot subscription (Pro, Pro+, Business or Enterprise), without an API key. Usage counts against your Copilot plan.

1.  Install the GitHub Copilot CLI on the machine that runs Trilium, for example with `npm install -g @github/copilot`. As with Claude Code, for a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> it needs to be installed on the server.
2.  Sign in by running `copilot login` in a terminal once. If you already use GitHub Copilot in another editor on the same machine, that login is reused.
3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the GitHub Copilot provider.

Trilium will identify your Copilot CLI in this order:

*   By looking for a `TRILIUM_COPILOT_PATH` environment variable pointing to the Copilot binary.
*   By looking for `copilot` in your PATH.
*   By asking your login shell for its `PATH`, the same as for Claude Code.

### Known limitations

*   The agent can only work with your notes through Trilium's note tools; its own file, shell and web tools are blocked for security reasons.
*   Images can be attached to the conversation, PDFs cannot. The LLM should still be able to read PDF notes and attachments via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a> when the note tools are enabled.

## Google Antigravity

> [!NOTE]
> This subscription-based provider is still in beta. It is safe to use (won't use additional funds and respects the terms of use), but you might experience small issues. Consider <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

Google Antigravity gives access to Gemini models using a Google account (free, Google AI Pro or Google AI Ultra), without an API key.

Unlike Claude Code or GitHub Copilot, Google's Antigravity ACP server is not part of the CLI so it needs to be installed manually just for Trilium. The downloaded archive is around 112-334 MB and the extracted size is around 230 MB-2 GB based on the platform.

On Windows, macOS and Linux (excluding NixOS):

1.  Download Google's Antigravity ACP server for your platform. The link is shown when adding the provider in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_. Unpack it on the device that runs Trilium.
2.  Make it findable by Trilium, either:
    1.  by adding the unpacked folder to your PATH, or
    2.  by setting a `TRILIUM_ANTIGRAVITY_ACP_PATH` environment variable pointing to `agy_acp_server.exe` (Windows) or `agy_acp_server.par` (Linux and macOS).
3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI / LLM and add the Google Antigravity provider. When the list of models is loaded for the first time, the Google sign-in page opens in a browser on the machine running Trilium; finish signing in there.

> [!NOTE]
> Trilium needs `curl` to use Google Antigravity. It comes with Windows 10 and later, macOS and most Linux distributions.

On NixOS, `antigravity-acp` package is already available but only in `nixos-unstable` at the time of writing. The easiest method to test it out is to use the `nix shell` with flakes:

```sh
NIXPKGS_ALLOW_UNFREE=1 nix shell --impure github:nixos/nixpkgs/nixos-unstable#antigravity-acp
trilium
```

### Known limitations

*   The agent can only work with your notes through Trilium's note tools; its own file and shell tools are blocked for security reasons.
*   The Antigravity ACP server requires authentication via a login link. The login link needs to be run on the same device, so it might not be possible to set up the provider while using the web version of a Docker installation. <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a> should work fine.
*   Images can be attached to the conversation, PDFs cannot. The LLM should still be able to read PDF notes and attachments via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a> when the note tools are enabled.
*   The results of tool calls (e.g. reading a note, writing attributes) are not properly displayed because they are not exposed by the ACP server.