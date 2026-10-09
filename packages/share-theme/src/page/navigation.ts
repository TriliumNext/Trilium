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

            if (isExpanded) {
                // Collapsing
                ul.style.height = `${ul.scrollHeight}px`;
                // Force reflow
                ul.offsetHeight;

                li.classList.remove("expanded");
                ul.style.height = "0";
            } else {
                // Expanding
                ul.style.height = "0";
                // Force reflow
                ul.offsetHeight;

                li.classList.add("expanded");
                ul.style.height = `${ul.scrollHeight}px`;
            }

            setTimeout(() => {
                ul.style.height = "";
            }, 200);
        });
    }
}
