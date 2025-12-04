import { animate } from "motion";

export function setupSearch() {
    const searchBtn = document.getElementById("search-btn");
    const searchContainer = document.getElementById("search-container");
    const searchInput = document.getElementById("search-input") as HTMLInputElement;
    const closeSearch = document.getElementById("close-search");
    const headerActions = document.getElementById("header-actions");
    const charactersGrid = document.getElementById("characters-grid");


    if (!searchBtn || !searchContainer || !searchInput || !closeSearch || !headerActions) {
        return;
    }

    function filterCharacters(query: string) {
        const cards = charactersGrid?.querySelectorAll(".character-card");
        if (!cards) return;

        const lowerQuery = query.toLowerCase().trim();

        cards.forEach((card) => {
            const name = card.querySelector(".character-name")?.textContent?.toLowerCase() || "";
            const shouldShow = name.includes(lowerQuery);

            if (shouldShow) {
                (card as HTMLElement).style.display = "block";
                animate(card, { opacity: [0, 1], scale: [0.95, 1] }, { duration: 0.3 });
            } else {
                animate(card, { opacity: [1, 0], scale: [1, 0.95] }, { duration: 0.2 })
                    .finished.then(() => {
                        (card as HTMLElement).style.display = "none";
                    });
            }
        });
    }

    searchBtn.addEventListener("click", () => {
        searchContainer.style.display = "flex";
        headerActions.style.display = "none";

        animate(
            searchContainer,
            { opacity: [0, 1], y: ["-10px", "0px"] },
            { duration: 0.3 }
        );

        searchInput.focus();
    });

    closeSearch.addEventListener("click", () => {
        animate(
            searchContainer,
            { opacity: [1, 0], y: ["0px", "-10px"] },
            { duration: 0.3 }
        ).finished.then(() => {
            searchContainer.style.display = "none";
            headerActions.style.display = "flex";
            searchInput.value = "";
            filterCharacters("");
        });
    });

    searchInput.addEventListener("input", (e) => {
        filterCharacters((e.target as HTMLInputElement).value);
    });
}