import { animate } from "motion";

export function setupEditMode() {
    const editBtn = document.getElementById("edit-btn");
    if (!editBtn) return;

    let editMode = false;

    editBtn.addEventListener("click", () => {
        editMode = !editMode;
        const deleteButtons = document.querySelectorAll(".delete-btn");
        const characterCards = document.querySelectorAll(".character-card");

        deleteButtons.forEach((btn) => {
            if (editMode) {
                (btn as HTMLElement).style.display = "flex";
                animate(
                    btn,
                    { opacity: [0, 1], scale: [0.8, 1] },
                    { duration: 0.3 }
                );
            } else {
                animate(
                    btn,
                    { opacity: [1, 0], scale: [1, 0.8] },
                    { duration: 0.2 }
                ).finished.then(() => {
                    (btn as HTMLElement).style.display = "none";
                });
            }
        });

        characterCards.forEach((card) => {
            card.classList.toggle("edit-mode", editMode);
            if (editMode) {
                animate(
                    card,
                    { scale: [1, 0.98, 1] },
                    { duration: 0.3 }
                );
            }
        });

        editBtn.classList.toggle("active", editMode);
        animate(
            editBtn,
            { rotate: editMode ? 90 : 0 },
            { duration: 0.3 }
        );
    });

    document.addEventListener("click", async (e) => {
        const target = e.target as HTMLElement;
        const deleteBtn = target.closest(".delete-btn") as HTMLElement | null;

        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();

            const characterId = deleteBtn.dataset.characterId;
            if (!characterId) return;

            if (confirm("Are you absolutely sure you want to delete this character? This action cannot be undone.")) {
                const cardToRemove = deleteBtn.closest(".character-card");

                try {
                    animate(
                        cardToRemove as HTMLElement,
                        { opacity: [1, 0], scale: [1, 0.9], x: ["0px", "-50px"] },
                        { duration: 0.4 }
                    ).finished.then(async () => {
                        const response = await fetch("/api/characters/delete", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ characterId }),
                        });

                        if (response.ok) {
                            cardToRemove?.remove();
                        } else {
                            alert("Failed to delete character.");
                            window.location.reload();
                        }
                    });
                } catch (error) {
                    alert("An unexpected error occurred.");
                    console.error("Deletion error:", error);
                    window.location.reload();
                }
            }
        }
    });
}