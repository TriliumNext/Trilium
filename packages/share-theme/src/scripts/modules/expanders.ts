// In case a linked article lead to a new tree
// const activeLink = document.querySelector("#menu a.active");
// if (activeLink) {
//     let parent = activeLink.parentElement;
//     const mainMenu = document.getElementById("#menu");
//     while (parent && parent !== mainMenu) {
//         if (parent.matches(".submenu-item") && !parent.classList.contains("expanded")) {
//             parent.classList.add("expanded");
//         }
//         parent = parent.parentElement;
//     }
// }

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
