
window.Cudi.showToast = function (message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = '';
    if (type === 'success') icon = ' ';
    if (type === 'error') icon = ' ';
    toast.textContent = icon + message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (container.contains(toast)) container.removeChild(toast);
        }, 300);
    }, 4000);
}

window.Cudi.toggleLoading = function (show, message = "Loading...") {
    const loadingOverlay = document.getElementById("loading-overlay");
    const loadingMessage = document.getElementById("loading-message");

    if (!loadingOverlay || !loadingMessage) return;

    if (show) {
        loadingMessage.textContent = message;
        loadingOverlay.classList.remove('hidden');
    } else {
        loadingOverlay.classList.add('hidden');
    }
}


window.Cudi.generarCodigo = function () {
    const { ADJECTIVES, COLORS, ANIMALS } = window.Cudi.DICTIONARY;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    return `${pick(ADJECTIVES)}-${pick(COLORS)}-${pick(ANIMALS)}`;
}
