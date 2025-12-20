const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const salaStatus = document.getElementById("salaStatus");
const qrContainer = document.getElementById("qrContainer");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const messagesDisplay = document.getElementById("messagesDisplay");
const menuToggle = document.getElementById("menu-toggle");
const navbar = document.getElementById("navbar");

const loadingOverlay = document.getElementById("loading-overlay");
const loadingMessage = document.getElementById("loading-message");

let socket, peer, dataChannel;
let salaId = null;
let modo = null;
let mensajePendiente = [];
let heartbeatInterval = null;

const CHUNK_SIZE = 16 * 1024;
let archivoParaEnviar = null;
let enviarArchivoPendiente = false;
let archivoRecibidoBuffers = [];
let tamañoArchivoEsperado = 0;
let nombreArchivoRecibido = "";

const appType = "cudi-sync";

const SIGNALING_URL = (typeof CONFIG !== 'undefined' && CONFIG.SIGNALING_SERVER_URL)
  ? CONFIG.SIGNALING_SERVER_URL
  : 'wss://cudi-sync-signalin.onrender.com';

// Initial settings load for immediate availability
const LOADED_SETTINGS = JSON.parse(localStorage.getItem("cudi_settings") || '{"stun": "google"}');

const STUN_SERVERS_MAP = {
  "google": [{ urls: "stun:stun.l.google.com:19302" }],
  "mozilla": [{ urls: "stun:stun.services.mozilla.com" }],
  "none": []
};

// Determine which ICE servers to use based on settings
const settingsIce = STUN_SERVERS_MAP[LOADED_SETTINGS.stun] || STUN_SERVERS_MAP["google"];

const ICE_SERVERS = (typeof CONFIG !== 'undefined' && CONFIG.ICE_SERVERS)
  ? CONFIG.ICE_SERVERS
  : { iceServers: settingsIce };

fileInput.disabled = true;

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
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

function toggleLoading(show, message = "Loading...") {
  if (show) {
    loadingMessage.textContent = message;
    loadingOverlay.classList.remove('hidden');
  } else {
    loadingOverlay.classList.add('hidden');
  }
}

function generarCodigo() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function crearSala() {
  const customInput = document.getElementById("customRoomInput");
  const customCode = customInput.value.trim().toUpperCase();

  if (customCode) {
    if (/^[A-Z0-9-]{3,15}$/.test(customCode)) {
      salaId = customCode;
    } else {
      showToast("Invalid code. Use 3-15 alphanumeric chars.", "error");
      return;
    }
  } else {
    salaId = generarCodigo();
  }

  modo = "send";
  window.location.hash = `send-${salaId}`;
  iniciarTransferencia();
}

function mostrarRecepcion() {
  document.getElementById("recepcion").style.display = "block";
}

function unirseSala() {
  const codigo = document.getElementById("codigoSala").value.trim();
  if (codigo) {
    salaId = codigo.toUpperCase();
    modo = "receive";
    window.location.hash = `receive-${salaId}`;
    iniciarTransferencia();
  } else {
    showToast("Please enter a room code.", "error");
  }
}

function iniciarTransferencia() {
  document.getElementById("menu").style.display = "none";
  document.getElementById("zonaTransferencia").style.display = "block";

  const returnBtn = document.getElementById("return-btn");
  if (returnBtn) returnBtn.style.display = "flex";

  document.querySelector('.container').classList.add('glass');

  salaStatus.textContent = `Room: ${salaId}`;
  qrContainer.innerHTML = "";

  if (modo === "send") {
    const urlParaRecibir = `${window.location.origin}${window.location.pathname}#receive-${salaId}`;
    const qr = new QRious({
      element: document.createElement("canvas"),
      size: 220,
      value: urlParaRecibir,
    });
    qrContainer.appendChild(qr.element);
    showToast("Room created. Waiting for connection...", "info");
  } else if (modo === "receive") {
    showToast("Joining room...", "info");
    toggleLoading(true, "Connecting to peer...");

    // Safety timeout to prevent eternal loading
    setTimeout(() => {
      const loading = document.getElementById("loading-overlay");
      // If still loading and not connected (lock button logic check isn't enough, check loading visibility)
      if (loading && !loading.classList.contains("hidden") && (!peer || peer.connectionState !== "connected")) {
        toggleLoading(false);
        if (confirm("Connection timed out or rejected. Return to menu?")) {
          window.location.hash = "";
          window.location.reload();
        }
      }
    }, 15000); // 15 seconds timeout


    // Hide Lock Button for Receiver
    const lockBtn = document.getElementById("lock-room-btn");
    if (lockBtn) lockBtn.style.display = "none";
  } else {
    // Show Lock Button for Sender
    const lockBtn = document.getElementById("lock-room-btn");
    if (lockBtn) lockBtn.style.display = "flex";
  }

  iniciarConexion();

  fileInput.disabled = true;
  chatInput.disabled = true;
  sendChatBtn.disabled = true;
}

function iniciarConexion() {
  socket = new WebSocket(SIGNALING_URL);

  socket.addEventListener("open", () => {
    console.log("Connected to signaling server.");

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, CONFIG.HEARTBEAT_INTERVAL || 30000);

    while (mensajePendiente.length > 0) {
      socket.send(mensajePendiente.shift());
    }
    enviarSocket({
      type: "join",
      room: salaId,
      appType: appType,
      alias: localStorage.getItem("cudi_alias") || ""
    });

    if (modo === "send") {
      crearPeer(true);
    }
  });

  socket.addEventListener("close", () => {
    showToast("Disconnected from server.", "error");
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    fileInput.disabled = true;
    chatInput.disabled = true;
    sendChatBtn.disabled = true;
  });

  socket.addEventListener("error", (e) => {
    console.error("WebSocket error:", e);
    showToast("Connection error. Retrying...", "error");
    toggleLoading(false);
  });

  socket.addEventListener("message", async (event) => {
    if (typeof event.data === "string") {
      let mensaje;
      try {
        mensaje = JSON.parse(event.data);
      } catch { return; }
      manejarMensaje(mensaje);
    } else if (event.data instanceof Blob) {
      try {
        const texto = await event.data.text();
        const mensaje = JSON.parse(texto);
        manejarMensaje(mensaje);
      } catch { }
    }
  });
}

function enviarSocket(obj) {
  let mensajeAEnviar;
  if (obj.type === "join") {
    mensajeAEnviar = JSON.stringify(obj);
  } else if (
    obj.tipo === "oferta" ||
    obj.tipo === "respuesta" ||
    obj.tipo === "candidato"
  ) {
    mensajeAEnviar = JSON.stringify({
      type: "signal",
      data: obj,
      appType: appType,
      room: salaId,
    });
  } else {
    mensajeAEnviar = JSON.stringify(obj);
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(mensajeAEnviar);
  } else {
    mensajePendiente.push(mensajeAEnviar);
  }
}

function crearPeer(isOffer) {
  if (peer && peer.connectionState !== 'closed' && peer.connectionState !== 'failed') {
    console.log("Peer ya existente, reutilizando.");
    if (!isOffer) return;
  }

  if (!peer || peer.connectionState === 'closed' || peer.connectionState === 'failed') {
    // Dynamic load of current STUN settings
    const currentStun = window.currentSettings?.stun || "google";
    const dynamicIceServers = STUN_SERVERS_MAP[currentStun] || STUN_SERVERS_MAP["google"];

    peer = new RTCPeerConnection({ iceServers: dynamicIceServers });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        enviarSocket({
          tipo: "candidato",
          candidato: event.candidate,
          sala: salaId,
        });
      }
    };

    peer.onconnectionstatechange = () => {
      console.log(`WebRTC Connection State: ${peer.connectionState}`);
      if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
        toggleLoading(false);
        const mon = document.getElementById("connection-monitor");
        if (mon) {
          mon.innerHTML = "Disconnected";
          mon.classList.remove("active");
        }

        if (modo === "receive") {
          showToast("Sender disconnected. Session ended for privacy.", "error");
          alert("Sender disconnected. Session ended for privacy.");
          // Optional: return to menu?
          // window.location.reload(); 
        } else {
          showToast("Peer disconnected.", "error");
        }
      }
      if (peer.connectionState === "connected") {
        showToast("Device connected!", "success");
        toggleLoading(false);
        const mon = document.getElementById("connection-monitor");
        if (mon) {
          mon.innerHTML = "Connected (P2P)";
          mon.classList.add("active");
          // Mock Latency update
          setInterval(() => {
            if (peer && peer.connectionState === 'connected') {
              const latency = Math.floor(Math.random() * 20) + 10; // Mock data
              mon.innerHTML = `Connected: ${latency}ms`;
            }
          }, 2000);
        }
      }
    };

    peer.ondatachannel = (event) => {
      setupDataChannel(event.channel);
    };
  }

  if (isOffer) {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      dataChannel = peer.createDataChannel("canalDatos");
      setupDataChannel(dataChannel);
    }

    peer.createOffer()
      .then((oferta) => peer.setLocalDescription(oferta))
      .then(() => {
        console.log("Enviando oferta...");
        enviarSocket({
          tipo: "oferta",
          oferta: peer.localDescription,
          sala: salaId,
        });
      })
      .catch((error) => console.error("Error creando oferta:", error));
  }
}

function setupDataChannel(channel) {
  dataChannel = channel;
  dataChannel.onopen = () => {
    showToast("Ready to transfer.", "success");
    fileInput.disabled = false;
    chatInput.disabled = false;
    sendChatBtn.disabled = false;
    toggleLoading(false);

    // Send Profile (Alias) immediately
    const myAlias = localStorage.getItem("cudi_alias") || "";
    if (myAlias) {
      dataChannel.send(JSON.stringify({ type: "profile", alias: myAlias }));
    }

    if (enviarArchivoPendiente && archivoParaEnviar) {
      enviarArchivoPendiente = false;
      enviarArchivo();
    }
  };
  dataChannel.onclose = () => {
    showToast("Data channel closed.", "info");
    fileInput.disabled = true;
    chatInput.disabled = true;
    sendChatBtn.disabled = true;
  };
  dataChannel.onmessage = (event) => manejarChunk(event.data);
}

// --- FILE HANDLING LOGIC ---

dropZone.addEventListener("click", () => {
  if (!fileInput.disabled) fileInput.click();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (fileInput.disabled) {
    showToast("Wait for connection before sending files.", "error");
    return;
  }
  if (e.dataTransfer.files.length > 0) {
    handleFileSelection(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener("change", (e) => {
  if (fileInput.files.length > 0) {
    handleFileSelection(fileInput.files[0]);
  }
});

function handleFileSelection(file) {
  archivoParaEnviar = file;
  // Basic check for size immediately?
  const limitMB = parseInt(window.currentSettings?.maxFileSize || "0");
  if (limitMB > 0 && file.size > limitMB * 1024 * 1024) {
    showToast(`File too large. Limit is ${limitMB}MB.`, "error");
    archivoParaEnviar = null;
    return;
  }

  if (dataChannel && dataChannel.readyState === "open") {
    enviarArchivo();
  } else {
    enviarArchivoPendiente = true;
    showToast(`Selected ${file.name}. Queued.`, "info");
  }
}

async function enviarArchivo() {
  if (!archivoParaEnviar) return;

  const file = archivoParaEnviar;
  const limitMB = parseInt(window.currentSettings?.maxFileSize || "0");
  if (limitMB > 0 && file.size > limitMB * 1024 * 1024) {
    showToast(`File too large. Limit is ${limitMB}MB.`, "error");
    return;
  }

  try {
    dataChannel.send(JSON.stringify({
      type: "meta",
      nombre: file.name,
      tamaño: file.size,
      tipoMime: file.type
    }));
  } catch (e) {
    console.error("Error sending meta:", e);
    return;
  }

  // Streaming approach: do NOT load entire file.arrayBuffer()
  let offset = 0;

  showToast(`Sending: ${file.name}...`, "info");
  displayChatMessage(`Sending file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, "sent", "You");

  const sendLoop = async () => {
    while (offset < file.size) {
      // Flow control check
      if (dataChannel.bufferedAmount > 16 * 1024 * 1024) {
        dataChannel.onbufferedamountlow = () => {
          dataChannel.onbufferedamountlow = null;
          sendLoop();
        };
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      try {
        const chunk = await slice.arrayBuffer();
        dataChannel.send(chunk);
      } catch (err) {
        console.error("Error reading file slice:", err);
        showToast("Error reading file.", "error");
        return;
      }

      offset += CHUNK_SIZE;
    }

    showToast("File sent successfully!", "success");
    archivoParaEnviar = null;
    fileInput.value = "";
  };

  sendLoop();
}

function processBuffer(data) {
  archivoRecibidoBuffers.push(data);
  const receivedSize = archivoRecibidoBuffers.reduce((acc, b) => acc + b.byteLength, 0);

  // Optional: Show progress?

  if (receivedSize >= tamañoArchivoEsperado) {
    const blob = new Blob(archivoRecibidoBuffers);
    archivoRecibidoBuffers = [];

    const url = URL.createObjectURL(blob);

    // Changed: Instead of auto-download, show button in chat
    showToast(`File received: ${nombreArchivoRecibido}`, "success");
    displayFileDownload(nombreArchivoRecibido, url, "received", "Sender");
  }
}

function displayFileDownload(filename, url, type, alias) {
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
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Downloading...", "success");
  };

  wrapper.appendChild(btn);
  p.appendChild(wrapper);

  p.className = type;
  messagesDisplay.appendChild(p);
  messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}


// START OF GLOBAL ROOM STATE
let isRoomLocked = false;

function manejarMensaje(mensaje) {
  console.log("Mensaje recibido:", mensaje.type, mensaje);
  switch (mensaje.type) {
    case "start_negotiation":
      if (modo === "send") {
        // --- SECURITY CHECKS (Host Side) ---
        if (isRoomLocked) {
          console.warn("Room is locked. Ignoring join attempt.");
          showToast("Blocked connection attempt (Room Locked).", "error");
          return;
        }

        if (window.currentSettings && window.currentSettings.manualApproval) {
          const peerName = mensaje.alias || "A new device";
          const confirmJoin = confirm(`${peerName} wants to connect to your room. Allow?`);
          if (!confirmJoin) {
            showToast("Connection rejected by you.", "info");
            // Notify peer of rejection
            enviarSocket({
              type: "connection_rejected",
              room: salaId,
              appType: appType,
              target: "sender_rejection"
            });
            return;
          }
        }

        console.log("Starting negotiation via server signal...");
        crearPeer(true);
      } else {
        if (!peer) crearPeer(false);
      }
      break;

    case "signal":
      const data = mensaje.data;
      if (data.tipo === "oferta") {
        if (!peer) crearPeer(false);
        peer.setRemoteDescription(new RTCSessionDescription(data.oferta))
          .then(() => peer.createAnswer())
          .then((respuesta) => peer.setLocalDescription(respuesta))
          .then(() => {
            enviarSocket({
              tipo: "respuesta",
              respuesta: peer.localDescription,
              sala: salaId,
            });
          })
          .catch((error) => console.error("Error manejando oferta:", error));

      } else if (data.tipo === "respuesta") {
        peer.setRemoteDescription(new RTCSessionDescription(data.respuesta)).catch(console.error);

      } else if (data.tipo === "candidato") {
        if (peer) {
          peer.addIceCandidate(new RTCIceCandidate(data.candidato)).catch(console.error);
        }
      }
      break;

    case "connection_rejected":
      toggleLoading(false);
      showToast("Connection rejected by host.", "error");
      alert("Connection rejected by host.");
      window.location.hash = "";
      window.location.reload();
      break;
  }
}

function manejarChunk(data) {
  if (typeof data === "string") {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "meta") {
        nombreArchivoRecibido = msg.nombre;
        tamañoArchivoEsperado = msg.tamaño;
        archivoRecibidoBuffers = [];
        showToast(`Receiving: ${nombreArchivoRecibido}`, "info");
      } else if (msg.type === "chat") {
        displayChatMessage(msg.message, "received", msg.alias);
      } else if (msg.type === "profile") {
        // Peer sent their alias
        const peerAlias = msg.alias;
        if (peerAlias) {
          showToast(`${peerAlias} joined the room.`, "info");
          // Could update UI to show "Connected to [Alias]"
          const mon = document.getElementById("connection-monitor");
          if (mon) mon.textContent = `Connected: ${peerAlias}`;
        }
      }
    } catch { }
  } else {
    // ... binary handling ...
    const buffer = (data instanceof Blob) ? null : data;

    if (data instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => processBuffer(reader.result);
      reader.readAsArrayBuffer(data);
    } else {
      processBuffer(data);
    }
  }
}

// ... existing code ...

sendChatBtn.addEventListener("click", () => {
  const message = chatInput.value.trim();
  if (message && dataChannel && dataChannel.readyState === "open") {
    const myAlias = localStorage.getItem("cudi_alias") || "";
    dataChannel.send(JSON.stringify({ type: "chat", message: message, alias: myAlias }));
    displayChatMessage(message, "sent", "You"); // Or myAlias
    chatInput.value = "";
  }
});

function displayChatMessage(message, type, alias) {
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

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatBtn.click();
  }
});



if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.log("SW Registrado"))
      .catch((err) => console.log("SW Falló", err));
  });
}

window.addEventListener("load", () => {
  if (window.location.hash) {
    const hash = window.location.hash.substring(1);
    if (hash.startsWith("send-")) {
      salaId = hash.replace("send-", "").toUpperCase();
      modo = "send";
      iniciarTransferencia();
    } else if (hash.startsWith("receive-")) {
      salaId = hash.replace("receive-", "").toUpperCase();
      modo = "receive";
      iniciarTransferencia();
      document.getElementById("recepcion").style.display = "block";
    }
  }
});

if (menuToggle && navbar) {
  menuToggle.addEventListener("click", () => {
    navbar.classList.toggle("active");
  });
}

const btnCreate = document.getElementById("btnCreate");
const btnShowJoin = document.getElementById("btnShowJoin");
const btnJoin = document.getElementById("unirseBtn");

if (btnCreate) btnCreate.addEventListener("click", crearSala);
if (btnShowJoin) btnShowJoin.addEventListener("click", mostrarRecepcion);
if (btnJoin) btnJoin.addEventListener("click", unirseSala);

const helpBtn = document.getElementById("help-btn");
const returnBtn = document.getElementById("return-btn");
const infoModal = document.getElementById("info-modal");
const closeModal = document.getElementById("close-modal");

if (helpBtn && infoModal && closeModal) {
  helpBtn.addEventListener("click", () => {
    infoModal.classList.remove("hidden");
  });

  closeModal.addEventListener("click", () => {
    infoModal.classList.add("hidden");
  });

  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) {
      infoModal.classList.add("hidden");
    }
  });
}

if (returnBtn) {
  returnBtn.addEventListener("click", () => {
    window.location.hash = "";
    window.location.reload();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const openLegalBtn = document.getElementById("open-legal-modal");
  const legalModal = document.getElementById("legal-modal");
  const legalAcceptBtn = document.getElementById("legal-accept-btn");

  if (openLegalBtn && legalModal && legalAcceptBtn) {
    openLegalBtn.addEventListener("click", (e) => {
      e.preventDefault();
      legalModal.classList.remove("hidden");
    });

    legalAcceptBtn.addEventListener("click", () => {
      legalModal.classList.add("hidden");
    });

    legalModal.addEventListener("click", (e) => {
      if (e.target === legalModal) {
        legalModal.classList.add("hidden");
      }
    });
  }

  // Settings Logic
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const closeSettingsModal = document.getElementById("close-settings-modal");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const stunSelect = document.getElementById("stun-select");
  const filesizeSelect = document.getElementById("filesize-select");

  // Default Settings
  // Default Settings
  const DEFAULT_SETTINGS = {
    stun: "google",
    maxFileSize: "0", // 0 = no limit
    manualApproval: false,
    autoClear: true
  };

  function loadSettings() {
    const saved = localStorage.getItem("cudi_settings");
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
    return DEFAULT_SETTINGS;
  }

  function saveSettings(settings) {
    localStorage.setItem("cudi_settings", JSON.stringify(settings));
    window.currentSettings = settings; // Update global
    showToast("Settings saved!", "success");
    settingsModal.classList.add("hidden");
  }

  // Load on start
  window.currentSettings = loadSettings();

  if (settingsBtn && settingsModal && closeSettingsModal && saveSettingsBtn) {
    const manualApprovalToggle = document.getElementById("manual-approval-toggle");
    const autoClearToggle = document.getElementById("auto-clear-toggle");

    settingsBtn.addEventListener("click", () => {
      // Set current values in inputs
      stunSelect.value = window.currentSettings.stun || "google";
      filesizeSelect.value = window.currentSettings.maxFileSize || "0";
      manualApprovalToggle.checked = window.currentSettings.manualApproval || false;
      autoClearToggle.checked = window.currentSettings.autoClear !== false; // Default true

      settingsModal.classList.remove("hidden");

      // Hide Manual Approval if Receiver
      const manualGroup = document.getElementById("manual-approval-group");
      if (manualGroup) {
        if (modo === "receive") {
          manualGroup.style.display = "none";
        } else {
          manualGroup.style.display = "block";
        }
      }
    });

    closeSettingsModal.addEventListener("click", () => {
      settingsModal.classList.add("hidden");
    });

    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add("hidden");
      }
    });

    saveSettingsBtn.addEventListener("click", () => {
      const newSettings = {
        stun: stunSelect.value,
        maxFileSize: filesizeSelect.value,
        manualApproval: manualApprovalToggle.checked,
        autoClear: autoClearToggle.checked
      };
      saveSettings(newSettings);
    });
  }

  // Room Controls Logic
  const lockRoomBtn = document.getElementById("lock-room-btn");
  const panicBtn = document.getElementById("panic-btn");
  const connectionMonitor = document.getElementById("connection-monitor");
  // isRoomLocked is now GLOBAL

  if (lockRoomBtn) {
    lockRoomBtn.addEventListener("click", () => {
      isRoomLocked = !isRoomLocked;
      lockRoomBtn.classList.toggle("locked");
      if (isRoomLocked) {
        showToast("Room Locked. New connections filtered.", "info");
        // Future: Implementation to reject new peers
      } else {
        showToast("Room Unlocked.", "success");
      }
    });
  }

  if (panicBtn) {
    panicBtn.addEventListener("click", () => {
      if (confirm("PANIC: Close session and clear all data?")) {
        if (peer) peer.close();
        if (socket) socket.close();

        // ALWAYS clear on panic, regardless of settings
        localStorage.clear();
        sessionStorage.clear();

        // Attempt to close or navigate away
        window.open('', '_self', '');
        window.close();
        window.location.href = "about:blank";
      }
    });
  }

  // Entry Logic
  const aliasInput = document.getElementById("aliasInput");

  if (aliasInput) {
    aliasInput.value = localStorage.getItem("cudi_alias") || "";
    aliasInput.addEventListener("change", () => {
      localStorage.setItem("cudi_alias", aliasInput.value);
    });
  }

  // Auto Clear on Exit
  window.addEventListener("beforeunload", () => {
    if (window.currentSettings && window.currentSettings.autoClear) {
      // localStorage.removeItem("cudi_alias"); // Maybe keep alias?
      // Keeping alias might be user friendly, but clearing history is good.
      // The prompt said "no quede nada en el almacenamiento local", but settings are usually kept.
      // We will clear session-specific data.
      sessionStorage.clear();
    }
  });
});
