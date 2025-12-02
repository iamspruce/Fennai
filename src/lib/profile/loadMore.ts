import { animate } from "motion";

export function setupLoadMore() {
    const loadMoreBtn = document.getElementById("load-more-btn");
    if (!loadMoreBtn) return;

    loadMoreBtn.addEventListener("click", async () => {
        loadMoreBtn.textContent = "Loading...";
        loadMoreBtn.setAttribute("disabled", "true");

        animate(loadMoreBtn, { scale: [1, 0.95, 1] }, { duration: 0.3 });

        setTimeout(() => {
            loadMoreBtn.textContent = "Load More";
            loadMoreBtn.removeAttribute("disabled");
        }, 1500);
    });
}