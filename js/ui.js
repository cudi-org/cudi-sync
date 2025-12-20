window.Cudi.elements = {
    dropZone: document.getElementById("dropZone"),
    fileInput: document.getElementById("fileInput"),
    salaStatus: document.getElementById("salaStatus"),
    qrContainer: document.getElementById("qrContainer"),
    chatInput: document.getElementById("chatInput"),
    sendChatBtn: document.getElementById("sendChatBtn"),
    messagesDisplay: document.getElementById("messagesDisplay"),
    menuToggle: document.getElementById("menu-toggle"),
    navbar: document.getElementById("navbar"),
    loadingOverlay: document.getElementById("loading-overlay"),
    loadingMessage: document.getElementById("loading-message"),
    connectionMonitor: document.getElementById("connection-monitor"),
    lockRoomBtn: document.getElementById("lock-room-btn"),
    panicBtn: document.getElementById("panic-btn"),
    recepcionDiv: document.getElementById("recepcion"),
    menuDiv: document.getElementById("menu"),
    zonaTransferenciaDiv: document.getElementById("zonaTransferencia"),
};

window.Cudi.displayChatMessage = function (message, type, alias) {
    const messagesDisplay = document.getElementById("messagesDisplay");
    if (!messagesDisplay) return;

    const p = document.createElement("p");

    if (alias === "System") {
        p.classList.add("system-message");
        p.textContent = message;
    } else {
        if (alias && alias.trim() !== "") {
            const userSpan = document.createElement("strong");
            userSpan.textContent = alias;
            userSpan.style.display = "block";
            userSpan.style.fontSize = "0.8rem";
            userSpan.style.marginBottom = "2px";
            userSpan.style.color = (type === "sent") ? "#eee" : "#555";
            p.appendChild(userSpan);
        }
        const msgSpan = document.createElement("span");
        msgSpan.textContent = message;
        p.appendChild(msgSpan);
    }

    p.classList.add(type);
    messagesDisplay.appendChild(p);
    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}

window.Cudi.displayFileDownload = function (filename, url, type, alias) {
    const messagesDisplay = document.getElementById("messagesDisplay");
    if (!messagesDisplay) return;

    const p = document.createElement("p");

    if (alias && alias !== "System") {
        const userSpan = document.createElement("strong");
        userSpan.textContent = alias;
        userSpan.style.display = "block";
        userSpan.style.fontSize = "0.8rem";
        userSpan.style.marginBottom = "2px";
        userSpan.style.color = (type === "sent") ? "#eee" : "#555";
        p.appendChild(userSpan);
    }

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "space-between";
    wrapper.style.gap = "10px";

    const textSpan = document.createElement("span");
    textSpan.textContent = `📎 ${filename}`;
    wrapper.appendChild(textSpan);

    const btn = document.createElement("button");
    btn.className = "download-btn-icon";
    btn.title = "Download";
    btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

    btn.onclick = () => {
        // Basic download via link
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    wrapper.appendChild(btn);
    p.appendChild(wrapper);

    p.className = type;
    messagesDisplay.appendChild(p);
    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}
