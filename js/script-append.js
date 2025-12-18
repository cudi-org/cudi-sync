
/* Legal Modal Logic */
const legalModal = document.getElementById("legal-modal");
const legalAcceptBtn = document.getElementById("legal-accept-btn");
const openLegalModalBtn = document.getElementById("open-legal-modal");

// Check if user has already accepted
if (!localStorage.getItem('legalAccepted')) {
    if (legalModal) legalModal.classList.remove('hidden');
}

if (legalAcceptBtn) {
    legalAcceptBtn.addEventListener("click", () => {
        localStorage.setItem('legalAccepted', 'true');
        if (legalModal) legalModal.classList.add('hidden');
    });
}

if (openLegalModalBtn) {
    openLegalModalBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (legalModal) legalModal.classList.remove('hidden');
    });
}

// Close legal modal by clicking outside (optional, but good UX) - reusing logic?
// Actually simpler to just add this tailored one since it forces acceptance on first load but maybe fine to close if triggered from footer.
// But for first load, maybe we should force them to click "Entendido".
// Let's only allow closing via the button for the first mandatory view.
// However, if opened from footer, they should be able to close it.
// We can check if it's currently blocking or not. But easier: just let the button close it.
// If opened from footer, maybe we want a close "X"? The HTML structure I added earlier doesn't have an X for the legal modal.
// I'll leave it as is: only the "Entendido, empezar" button closes it. That's safe.
