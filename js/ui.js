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

    // Determine info to show
    let displayAlias = alias;
    // Fallback if empty
    if (!displayAlias || displayAlias.trim() === "") {
        displayAlias = (type === "sent") ? "You" : "Guest";
    }

    if (displayAlias === "System") {
        p.classList.add("system-message");
        p.textContent = message;
    } else {
        // Always show the Name for clarity in chatting
        const userSpan = document.createElement("strong");
        userSpan.textContent = displayAlias;
        userSpan.style.display = "block";
        userSpan.style.fontSize = "0.75rem";
        userSpan.style.marginBottom = "4px";
        userSpan.style.opacity = "0.8";
        // Sent messages header lighter, Received darker (or logic from styles)
        userSpan.style.color = (type === "sent") ? "#f0f0f0" : "#555";
        p.appendChild(userSpan);

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

    // Determine info to show
    let displayAlias = alias;
    if (!displayAlias || displayAlias.trim() === "") {
        displayAlias = (type === "sent") ? "You" : "Guest";
    }

    if (displayAlias && displayAlias !== "System") {
        const userSpan = document.createElement("strong");
        userSpan.textContent = displayAlias;
        userSpan.style.display = "block";
        userSpan.style.fontSize = "0.75rem";
        userSpan.style.marginBottom = "4px";
        userSpan.style.color = (type === "sent") ? "#eee" : "#555";
        p.appendChild(userSpan);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "media-wrapper";

    // Media Logic
    const ext = filename.split('.').pop().toLowerCase();
    let mediaElement = null;

    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        // Image
        mediaElement = document.createElement('img');
        mediaElement.src = url;
        mediaElement.className = 'chat-media-img';
        mediaElement.onclick = () => {
            const win = window.open();
            if (win) {
                win.document.write('<img src="' + url + '" style="width:100%; height:auto;">');
            }
        };
    } else if (['mp3', 'wav', 'ogg'].includes(ext)) {
        // Audio
        mediaElement = document.createElement('audio');
        mediaElement.src = url;
        mediaElement.controls = true;
        mediaElement.className = 'chat-media-audio';
    } else if (['mp4', 'webm'].includes(ext)) {
        // Video
        mediaElement = document.createElement('video');
        mediaElement.src = url;
        mediaElement.controls = true;
        mediaElement.playsInline = true;
        mediaElement.className = 'chat-media-video';
    }

    if (mediaElement) {
        wrapper.appendChild(mediaElement);
    }

    // Header (Filename + Download)
    const headerDiv = document.createElement("div");
    headerDiv.className = "media-header";

    const textSpan = document.createElement("span");
    textSpan.textContent = filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
    textSpan.title = filename;
    headerDiv.appendChild(textSpan);

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

        // Memory cleanup: Revoke the URL after download starts -- deferred to avoid breaking playback
        // In media case, we might want to keep it longer or not revoke until session end?
        // Let's keep existing logic but careful with loops.
        // Actually, if it's playing, we shouldn't revoke. 
        // We already have the Blob URL provided.
    };

    headerDiv.appendChild(btn);
    wrapper.appendChild(headerDiv);

    p.appendChild(wrapper);

    p.className = type;
    messagesDisplay.appendChild(p);
    messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}
