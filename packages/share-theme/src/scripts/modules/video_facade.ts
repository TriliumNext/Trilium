/**
 * Click-to-play for the link-preview video embeds.
 *
 * The shared page ships only the thumbnail stored in the note (see the share content renderer), so
 * reading a page that contains a video does not tell YouTube that the visitor read it. The player is
 * loaded here, on the visitor's own click — which doubles as the play command, hence `autoplay=1`.
 */
export default function setupVideoFacades() {
    const facades = document.querySelectorAll<HTMLButtonElement>(".link-embed-video-facade[data-video-id]");

    for (const facade of facades) {
        facade.addEventListener("click", () => {
            const videoId = facade.dataset.videoId;
            const container = facade.parentElement;
            if (!videoId || !container) {
                return;
            }

            const iframe = document.createElement("iframe");
            iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?rel=0&autoplay=1`;
            iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
            iframe.referrerPolicy = "strict-origin-when-cross-origin";
            iframe.allowFullscreen = true;

            container.replaceChildren(iframe);
        });
    }
}
