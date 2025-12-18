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

const ICE_SERVERS = (typeof CONFIG !== 'undefined' && CONFIG.ICE_SERVERS)
  ? CONFIG.ICE_SERVERS
  : [{ urls: "stun:stun.l.google.com:19302" }];

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
    peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

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
        showToast("P2P connection lost or unstable.", "error");
        toggleLoading(false);
      }
      if (peer.connectionState === "connected") {
        showToast("Device connected!", "success");
        toggleLoading(false);
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

function manejarMensaje(mensaje) {
  console.log("Mensaje recibido:", mensaje.type, mensaje);
  switch (mensaje.type) {
    case "start_negotiation":
      if (modo === "send") {
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
  }
}

dropZone.addEventListener("click", () => {
  if (!fileInput.disabled) {
    fileInput.click();
  } else {
    showToast("Connect to a peer before sending.", "info");
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (!fileInput.disabled) {
    dropZone.classList.add("dragover");
  }
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (fileInput.disabled) {
    showToast("Cannot send files right now.", "error");
    return;
  }
  const archivos = e.dataTransfer.files;
  if (archivos.length > 0) prepararEnvioArchivo(archivos[0]);
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) prepararEnvioArchivo(fileInput.files[0]);
});

function prepararEnvioArchivo(archivo) {
  archivoParaEnviar = archivo;
  showToast(`File selected: ${archivo.name}`, "info");
  enviarArchivoPendiente = true;
  enviarArchivo();
}

function enviarArchivo() {
  if (!dataChannel || dataChannel.readyState !== "open") return;
  if (!archivoParaEnviar) return;

  const meta = {
    type: "meta",
    nombre: archivoParaEnviar.name,
    tamaño: archivoParaEnviar.size,
  };
  dataChannel.send(JSON.stringify(meta));

  const lector = new FileReader();
  let offset = 0;

  lector.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;
    const porcentaje = ((offset / archivoParaEnviar.size) * 100).toFixed(0);

    if (offset % (CHUNK_SIZE * 10) === 0 || offset === archivoParaEnviar.size) {
      salaStatus.textContent = `Sending: ${porcentaje}%`;
    }

    if (offset < archivoParaEnviar.size) {
      leerSlice(offset);
    } else {
      showToast("File sent successfully.", "success");
      salaStatus.textContent = `Room: ${salaId}`;
      archivoParaEnviar = null;
      fileInput.value = "";
    }
  };

  function leerSlice(desde) {
    const slice = archivoParaEnviar.slice(desde, desde + CHUNK_SIZE);
    lector.readAsArrayBuffer(slice);
  }
  leerSlice(0);
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
        displayChatMessage(msg.message, "received");
      }
    } catch { }
  } else {
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

function processBuffer(buffer) {
  archivoRecibidoBuffers.push(buffer);
  let tamañoRecibido = archivoRecibidoBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const porcentaje = ((tamañoRecibido / tamañoArchivoEsperado) * 100).toFixed(0);
  salaStatus.textContent = `Receiving: ${porcentaje}%`;

  if (tamañoRecibido >= tamañoArchivoEsperado) {
    const archivoBlob = new Blob(archivoRecibidoBuffers);
    const urlDescarga = URL.createObjectURL(archivoBlob);

    const a = document.createElement('a');
    a.href = urlDescarga;
    a.download = nombreArchivoRecibido;

    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = ` Download ${nombreArchivoRecibido}`;
    downloadBtn.className = "download-action-btn";
    downloadBtn.onclick = () => {
      a.click();
      URL.revokeObjectURL(urlDescarga);
      downloadBtn.remove();
      salaStatus.innerHTML = "";
    };

    salaStatus.innerHTML = "";
    salaStatus.appendChild(downloadBtn);

    showToast(`File ready: ${nombreArchivoRecibido}`, "success");

    archivoRecibidoBuffers = [];
    tamañoArchivoEsperado = 0;
  }
}

sendChatBtn.addEventListener("click", () => {
  const message = chatInput.value.trim();
  if (message && dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify({ type: "chat", message: message }));
    displayChatMessage(message, "sent");
    chatInput.value = "";
  }
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatBtn.click();
  }
});

function displayChatMessage(message, type) {
  const p = document.createElement("p");
  p.textContent = message;
  p.className = type;
  messagesDisplay.appendChild(p);
  messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
}

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
});
