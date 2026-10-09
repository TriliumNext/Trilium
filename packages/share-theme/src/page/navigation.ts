import "./navigation.css";

export default function setupExpanders() {
    const expanders = document.querySelectorAll("#menu .submenu-item .collapse-button");
    for (const expander of expanders) {
        const li = expander.closest("li");
        if (!li) {
            continue;
        }

        expander.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();

            const ul = li.querySelector("ul");
            if (!ul) {
                return;
            }

            const isExpanded = li.classList.contains("expanded");
            // Only a moving subtree is clipped, so the current note's shadow shows otherwise.
            ul.style.overflow = "hidden";

            if (isExpanded) {
                // Collapsing
                ul.style.height = `${ul.scrollHeight}px`;
                // Force reflow
                ul.offsetHeight;

                li.classList.remove("expanded");
                expander.setAttribute("aria-expanded", "false");
                ul.style.height = "0";
            } else {
                // Expanding
                ul.style.height = "0";
                // Force reflow
                ul.offsetHeight;

                li.classList.add("expanded");
                expander.setAttribute("aria-expanded", "true");
                ul.style.height = `${ul.scrollHeight}px`;
            }

            setTimeout(() => {
                ul.style.height = "";
                ul.style.overflow = "";
            }, 200);
        });
    }
}
