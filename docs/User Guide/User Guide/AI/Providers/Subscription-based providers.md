# Subscription-based providers
Some cloud providers offer a subscription, which has a fixed monthly fee instead of pay-per-use (unlike the API keys).

In a nutshell, subscription-based providers work by either reusing your existing CLI tools (e.g. Claude Code, GitHub Copilot and OpenAI Codex via ACP) whereas some require installing the ACP server manually (e.g. Google Antigravity). Because they require something to be installed on your device, these providers are not available on Mobile (Android or iOS) or standalone mode.

See also the dedicated <a class="reference-link" href="../Privacy.md">Privacy</a> section to better understand what data is being sent to a cloud provider.

## Using the Flatpak

The Flatpak version of Trilium (see [Installing from Flathub](../../Installation%20%26%20Setup/Desktop%20Installation.md)) runs in a sandbox that hides the programs installed on your computer, so on its own it cannot find Claude Code, the GitHub Copilot CLI, the Codex CLI or Google's Antigravity ACP server. Trilium can start them outside the sandbox once you allow it to:

1.  Install the CLI on your computer and sign in to it, as described below for each provider.
2.  Allow Trilium to start programs outside its sandbox by running this in a terminal:
    
    ```sh
    flatpak override --user --talk-name=org.freedesktop.Flatpak org.triliumnotes.Trilium
    ```
3.  Restart Trilium, then go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the provider.

Trilium then looks the CLI up in your computer's `PATH` and in your login shell's, and starts it there through `flatpak-spawn --host`. Until the permission is granted, adding one of these providers fails with a message that repeats these steps.

> [!WARNING]
> This permission lets Trilium run any program on your computer outside the sandbox, which is the same access an installation outside Flatpak has. To take it back, run `flatpak override --user --no-talk-name=org.freedesktop.Flatpak org.triliumnotes.Trilium` and restart Trilium.

The environment variables that point Trilium at a CLI (such as `TRILIUM_CLAUDE_CODE_PATH`) name a file inside the sandbox, so with the Flatpak, leave them unset and let Trilium find the CLI on your computer.

## <span class="tn-icon tn-brand tn-brand-claude"></span> Claude Code

To use a subscription:

1.  First, Claude Code needs to be installed on the machine that runs Trilium. So for a <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a>, Claude needs to be installed locally and for a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> accessed via a browser, Claude needs to be installed on the server.
2.  Claude Code must already be authenticated. To do so, run `claude` in a terminal once, type `/login` and follow the instructions.
3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the Claude Code provider.

<details>
    <summary>How Trilium identifies your Claude Code binary</summary>
    <p>In this order:</p>
    <ul>
        <li>By looking for a <code>TRILIUM_CLAUDE_CODE_PATH</code> environment variable pointing to the Claude binary. This allows overriding the path if needed.</li>
        <li>By looking for <code>claude</code> in your PATH, generally works in most circumstances.</li>
        <li>By asking your login shell for its <code>PATH</code> which lets a desktop install find a CLI installed through <code>nvm</code>, <code>fnm</code>, <code>asdf</code> or Homebrew, since a GUI-launched app doesn't inherit your terminal's environment.</li>
    </ul>
</details>

After your provider is set up, you'll benefit from the same features as an API key (note tools, web search, extended thinking, image/PDF attachments, streaming).

> [!NOTE]
> Trilium intentionally uses your Claude Code binary in order not to have to package a ~250 MB client with it, but this comes at a cost: there is a small risk for a version incompatibility, if the version installed locally doesn't match the one expected by Trilium. Generally it's best to keep both Claude Code and Trilium updated to the latest version.

## <span class="tn-icon tn-brand tn-brand-github-copilot"></span> GitHub Copilot

> [!NOTE]
> This subscription-based provider is still in beta. It is safe to use (won't use additional funds and respects the terms of use), but you might experience small issues. Consider <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

GitHub Copilot gives access to the models of your GitHub Copilot subscription (Pro, Pro+, Business or Enterprise), without an API key. Usage counts against your Copilot plan.

1.  Install the GitHub Copilot CLI on the machine that runs Trilium, for example with `npm install -g @github/copilot`. As with Claude Code, for a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> it needs to be installed on the server.
2.  Sign in by running `copilot login` in a terminal once. If you already use GitHub Copilot in another editor on the same machine, that login is reused.
3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the GitHub Copilot provider.

<details>
    <summary>How Trilium identifies your Copilot CLI binary</summary>
    <p>In this order:</p>
    <ul>
        <li>By looking for a <code>TRILIUM_COPILOT_PATH</code> environment variable pointing to the Copilot binary.</li>
        <li>By looking for <code>copilot</code> in your PATH.</li>
        <li>By asking your login shell for its <code>PATH</code>, the same as for Claude Code.</li>
    </ul>
</details>

### Known limitations

*   The agent can only work with your notes through Trilium's note tools; its own file, shell and web tools are blocked for security reasons.
*   Images can be attached to the conversation, PDFs cannot. The LLM should still be able to read PDF notes and attachments via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a> when the note tools are enabled.

## <span class="tn-icon tn-brand tn-brand-antigravity"></span> Google Antigravity

> [!NOTE]
> This subscription-based provider is still in beta. It is safe to use (won't use additional funds and respects the terms of use), but you might experience small issues. Consider <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

Google Antigravity gives access to Gemini models using a Google account (free, Google AI Pro or Google AI Ultra), without an API key. At the time of writing, a free Google account is enough to use it.

Unlike Claude Code or GitHub Copilot, Google's Antigravity ACP server is not part of the CLI so it needs to be installed manually just for Trilium. The downloaded archive is around 112-334 MB and the extracted size is around 230 MB-2 GB based on the platform.

=== "<span class="tn-icon bx bxl-windows"></span> Windows"

    1.  Download Google's Antigravity ACP server for your platform. The link is shown when adding the provider in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_. Unpack it on the device that runs Trilium.
    2.  Make it findable by Trilium, either:
        1.  by adding the unpacked folder to your PATH, or
        2.  by setting a `TRILIUM_ANTIGRAVITY_ACP_PATH` environment variable pointing to `agy_acp_server.exe`.
    3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI / LLM and add the <span class="tn-icon tn-brand tn-brand-antigravity"></span> _Google Antigravity_ provider. When the list of models is loaded for the first time, the Google sign-in page opens in a browser on the machine running Trilium; finish signing in there.

=== "<span class="tn-icon bx bxl-tux"></span> Linux & <span class="tn-icon bx bxl-apple"></span> macOS"

    1.  Download Google's Antigravity ACP server for your platform. The link is shown when adding the provider in <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_. Unpack it on the device that runs Trilium.
    2.  Make it findable by Trilium, either:
        1.  by adding the unpacked folder to your PATH, or
        2.  by setting a `TRILIUM_ANTIGRAVITY_ACP_PATH` environment variable pointing to `agy_acp_server.par`.
    3.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI / LLM and add the <span class="tn-icon tn-brand tn-brand-antigravity"></span> _Google Antigravity_ provider. When the list of models is loaded for the first time, the Google sign-in page opens in a browser on the machine running Trilium; finish signing in there.

=== "NixOS"

    1.  On NixOS, `antigravity-acp` package is already available but only in `nixos-unstable` at the time of writing. The easiest method to test it out is to use the `nix shell` with flakes:
        
        ```
        NIXPKGS_ALLOW_UNFREE=1 nix shell --impure github:nixos/nixpkgs/nixos-unstable#antigravity-acp
        trilium
        ```
    2.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → AI / LLM and add the <span class="tn-icon tn-brand tn-brand-antigravity"></span> _Google Antigravity_ provider. When the list of models is loaded for the first time, the Google sign-in page opens in a browser on the machine running Trilium; finish signing in there.

> [!NOTE]
> Trilium needs `curl` to use Google Antigravity. It comes with Windows 10 and later, macOS and most Linux distributions.

### Known limitations

*   The agent can only work with your notes through Trilium's note tools; its own file and shell tools are blocked for security reasons.
*   The Antigravity ACP server requires authentication via a login link. The login link needs to be run on the same device, so it might not be possible to set up the provider while using the web version of a Docker installation. <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a> should work fine.
*   Images can be attached to the conversation, PDFs cannot. The LLM should still be able to read PDF notes and attachments via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a> when the note tools are enabled.
*   The results of tool calls (e.g. reading a note, writing attributes) are not properly displayed because they are not exposed by the ACP server.

## <span class="tn-icon tn-brand tn-brand-codex"></span> OpenAI Codex

> [!NOTE]
> This subscription-based provider is still in beta. It is safe to use (won't use additional funds and respects the terms of use), but you might experience small issues. Consider <a class="reference-link" href="../../Troubleshooting/Reporting%20issues.md">Reporting issues</a>.

OpenAI Codex gives access to the Codex models of your ChatGPT plan (Free, Go, Plus, Pro or Business), without an API key. At the time of writing, a free ChatGPT account is enough to use it. Usage counts against your plan's Codex limits, which are small on the Free plan.

=== "<span class="tn-icon bx bxl-windows"></span><span class="tn-icon bx bxl-tux"></span><span class="tn-icon bx bxl-apple"></span> Most platforms"

    1.  Install the Codex CLI on the machine that runs Trilium, for example with `npm install -g @openai/codex`. As with Claude Code, for a <a class="reference-link" href="../../Installation%20%26%20Setup/Server%20Installation.md">Server Installation</a> it needs to be installed on the server. Trilium ships the ACP adapter that connects to it, so nothing else is needed.
    2.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the <span class="tn-icon tn-brand tn-brand-codex"></span> _OpenAI Codex_ provider. When the list of models is loaded for the first time, the ChatGPT sign-in page opens in a browser on the machine running Trilium; finish signing in there.

=== "NixOS"

    1.  On NixOS, Codex is available as the `codex` package in nixpkgs. The stable channel can lag behind Codex's releases, so a newer version can be taken from `nixos-unstable`:
        
        ```sh
        nix shell github:nixos/nixpkgs/nixos-unstable#codex
        trilium
        ```
    2.  Go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _AI / LLM_ and add the <span class="tn-icon tn-brand tn-brand-codex"></span> _OpenAI Codex_ provider. When the list of models is loaded for the first time, the ChatGPT sign-in page opens in a browser on the machine running Trilium; finish signing in there.

Trilium keeps its own Codex sign-in and settings, separate from any Codex CLI you use in a terminal, so an existing `codex login` is not reused.

<details>
    <summary>How Trilium identifies your Codex CLI binary</summary>
    <p>In this order:</p>
    <ul>
        <li>By looking for a <code>TRILIUM_CODEX_PATH</code> environment variable pointing to the Codex binary.</li>
        <li>By looking for <code>codex</code> in your PATH.</li>
        <li>By asking your login shell for its <code>PATH</code>, the same as for Claude Code.</li>
    </ul>
</details>

> [!NOTE]
> Trilium needs `curl` to use OpenAI Codex, the same as for Google Antigravity: Trilium checks every tool call Codex makes through it. It comes with Windows 10 and later, macOS and most Linux distributions.

### Known limitations

*   The agent can only work with your notes through Trilium's note tools, and search the web when the chat allows it; its own file, shell and other tools are blocked for security reasons.
*   The ChatGPT sign-in opens in a browser on the device running Trilium, so it might not be possible to set up the provider while using the web version of a Docker installation. <a class="reference-link" href="../../Installation%20%26%20Setup/Desktop%20Installation.md">Desktop Installation</a> should work fine.
*   Images and SVGs can be attached to the conversation, PDFs cannot. The LLM should still be able to read PDF notes and attachments via <a class="reference-link" href="../../Advanced%20Usage/Text%20Extraction%20(OCR).md">Text Extraction (OCR)</a> when the note tools are enabled.