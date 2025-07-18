const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const status = document.getElementById("status");
const salaStatus = document.getElementById("salaStatus");
const qrContainer = document.getElementById("qrContainer");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const messagesDisplay = document.getElementById("messagesDisplay");

let socket, peer, dataChannel;
let salaId = null;
let modo = null;

let mensajePendiente = [];

const CHUNK_SIZE = 16 * 1024;
let archivoParaEnviar = null;
let enviarArchivoPendiente = false;
let archivoRecibidoBuffers = [];
let tamañoArchivoEsperado = 0;
let nombreArchivoRecibido = "";

fileInput.disabled = true;

function generarCodigo() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function crearSala() {
  salaId = generarCodigo();
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
    alert("Por favor, introduce un código de sala.");
  }
}

function iniciarTransferencia() {
  document.getElementById("menu").style.display = "none";
  document.getElementById("zonaTransferencia").style.display = "block";

  salaStatus.textContent = `Sala: ${salaId}`;
  qrContainer.innerHTML = "";

  if (modo === "send") {
    const urlParaRecibir = `${window.location.origin}${window.location.pathname}#receive-${salaId}`;
    const qr = new QRious({
      element: document.createElement("canvas"),
      size: 220,
      value: urlParaRecibir,
    });
    qrContainer.appendChild(qr.element);

    status.innerText = "Sala creada. Esperando conexión...";
  } else if (modo === "receive") {
    status.innerText = "Uniéndose a la sala, esperando conexión...";
  }

  iniciarConexion();

  fileInput.disabled = true;
  chatInput.disabled = true;
  sendChatBtn.disabled = true;
}

function iniciarConexion() {
  socket = new WebSocket("wss://cudi-sync-signalin.onrender.com");

  socket.addEventListener("open", () => {
    status.innerText = "Conectado al servidor de señalización.";

    while (mensajePendiente.length > 0) {
      socket.send(mensajePendiente.shift());
    }

    enviarSocket({
      type: "join",
      room: salaId,
    });

    if (modo === "send") {
      crearPeer(true);
    } else {
      crearPeer(false);
    }
  });

  socket.addEventListener("close", () => {
    status.innerText = "Conexión al servidor de señalización cerrada.";
    fileInput.disabled = true;
    chatInput.disabled = true;
    sendChatBtn.disabled = true;
  });

  socket.addEventListener("error", (e) => {
    status.innerText = "Error en la conexión WebSocket.";
  });

  socket.addEventListener("message", async (event) => {
    if (typeof event.data === "string") {
      let mensaje;
      try {
        mensaje = JSON.parse(event.data);
      } catch {
        return;
      }
      manejarMensaje(mensaje);
    } else if (event.data instanceof Blob) {
      try {
        const texto = await event.data.text();
        const mensaje = JSON.parse(texto);
        manejarMensaje(mensaje);
      } catch {}
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
    mensajeAEnviar = JSON.stringify({ type: "signal", data: obj });
  } else {
    mensajeAEnviar = JSON.stringify(obj);
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(mensajeAEnviar);
  } else {
    mensajePendiente.push(mensajeAEnviar);
  }
}

function crearPeer(isOffer) {
  peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

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
    status.innerText = `Estado de conexión WebRTC: ${peer.connectionState}`;
    if (
      peer.connectionState === "disconnected" ||
      peer.connectionState === "failed" ||
      peer.connectionState === "closed"
    ) {
      status.innerText = `Conexión WebRTC ${peer.connectionState}.`;
      fileInput.disabled = true;
      chatInput.disabled = true;
      sendChatBtn.disabled = true;
    }
    if (peer.connectionState === "connected") {
      status.innerText = "Conexión WebRTC establecida.";
    }
  };

  peer.oniceconnectionstatechange = () => {};
  peer.onicegatheringstatechange = () => {};

  if (isOffer) {
    dataChannel = peer.createDataChannel("canalDatos");

    dataChannel.onopen = () => {
      status.innerText =
        "Canal de datos abierto. Listo para enviar archivos y chatear.";
      fileInput.disabled = false;
      chatInput.disabled = false;
      sendChatBtn.disabled = false;

      if (enviarArchivoPendiente && archivoParaEnviar) {
        enviarArchivoPendiente = false;
        enviarArchivo();
      }
    };

    dataChannel.onclose = () => {
      status.innerText = "Canal de datos cerrado.";
      fileInput.disabled = true;
      chatInput.disabled = true;
      sendChatBtn.disabled = true;
    };

    dataChannel.onerror = (error) => {};

    dataChannel.onmessage = (event) => {
      manejarChunk(event.data);
    };

    peer
      .createOffer()
      .then((oferta) => {
        return peer.setLocalDescription(oferta);
      })
      .then(() => {
        enviarSocket({
          tipo: "oferta",
          oferta: peer.localDescription,
          sala: salaId,
        });
      })
      .catch((error) => {});
  } else {
    peer.ondatachannel = (event) => {
      dataChannel = event.channel;

      dataChannel.onopen = () => {
        status.innerText =
          "Canal de datos abierto. Listo para recibir archivos y chatear.";
        fileInput.disabled = true;
        chatInput.disabled = false;
        sendChatBtn.disabled = false;
      };

      dataChannel.onclose = () => {
        status.innerText = "Canal de datos cerrado.";
        fileInput.disabled = true;
        chatInput.disabled = true;
        sendChatBtn.disabled = true;
      };

      dataChannel.onerror = (error) => {};

      dataChannel.onmessage = (event) => {
        manejarChunk(event.data);
      };
    };
  }
}

function manejarMensaje(mensaje) {
  switch (mensaje.type) {
    case "signal":
      const data = mensaje.data;

      if (data.tipo === "oferta") {
        if (!peer) {
          crearPeer(false);
        }
        peer
          .setRemoteDescription(data.oferta)
          .then(() => {
            return peer.createAnswer();
          })
          .then((respuesta) => {
            return peer.setLocalDescription(respuesta);
          })
          .then(() => {
            enviarSocket({
              tipo: "respuesta",
              respuesta: peer.localDescription,
              sala: salaId,
            });
          })
          .catch((error) => {});
      } else if (data.tipo === "respuesta") {
        peer.setRemoteDescription(data.respuesta).catch((error) => {});
      } else if (data.tipo === "candidato") {
        if (peer) {
          peer.addIceCandidate(data.candidato).catch((error) => {});
        }
      }
      break;

    case "ready":
      status.innerText =
        "Conexión WebRTC establecida. Listo para transferencia.";
      break;

    case "cerrar":
      if (peer) {
        peer.close();
        peer = null;
        status.innerText = "Conexión finalizada.";
        fileInput.disabled = true;
        chatInput.disabled = true;
        sendChatBtn.disabled = true;
      }
      break;

    default:
      break;
  }
}

dropZone.addEventListener("click", () => {
  if (!fileInput.disabled) {
    fileInput.click();
  } else {
    status.innerText =
      "Esperando que la conexión esté lista para seleccionar un archivo.";
  }
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (modo === "send" && !fileInput.disabled) {
    dropZone.classList.add("dragover");
  }
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (modo !== "send" || fileInput.disabled) {
    status.innerText = "La conexión no está lista para enviar un archivo.";
    return;
  }

  const archivos = e.dataTransfer.files;
  if (archivos.length > 0) {
    prepararEnvioArchivo(archivos[0]);
  }
});

fileInput.addEventListener("change", () => {
  if (modo !== "send" || fileInput.disabled) return;
  if (fileInput.files.length > 0) {
    prepararEnvioArchivo(fileInput.files[0]);
  }
});

function prepararEnvioArchivo(archivo) {
  archivoParaEnviar = archivo;
  status.innerText = `Archivo listo para enviar: ${archivo.name} (${archivo.size} bytes)`;
  enviarArchivoPendiente = true;
  enviarArchivo();
}

function enviarArchivo() {
  if (!dataChannel || dataChannel.readyState !== "open") {
    status.innerText = "Canal de datos no está abierto aún. Esperando...";
    return;
  }

  if (!archivoParaEnviar) {
    status.innerText = "No hay archivo para enviar.";
    return;
  }

  status.innerText = `Enviando archivo: ${archivoParaEnviar.name} (${archivoParaEnviar.size} bytes)`;

  const meta = {
    type: "meta",
    nombre: archivoParaEnviar.name,
    tamaño: archivoParaEnviar.size,
  };
  dataChannel.send(JSON.stringify(meta));

  const lector = new FileReader();
  let offset = 0;

  lector.onerror = (e) => {
    status.innerText = "Error leyendo archivo.";
  };

  lector.onabort = () => {
    status.innerText = "Lectura de archivo abortada.";
  };

  lector.onload = (e) => {
    dataChannel.send(e.target.result);
    offset += e.target.result.byteLength;
    const porcentaje = ((offset / archivoParaEnviar.size) * 100).toFixed(2);
    status.innerText = `Enviando archivo: ${archivoParaEnviar.name} (${offset} / ${archivoParaEnviar.size} bytes) - ${porcentaje}%`;

    if (offset < archivoParaEnviar.size) {
      leerSlice(offset);
    } else {
      status.innerText = `Archivo ${archivoParaEnviar.name} enviado correctamente.`;
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
        status.innerText = `Recibiendo archivo: ${nombreArchivoRecibido} (0 / ${tamañoArchivoEsperado} bytes)`;
        return;
      } else if (msg.type === "chat") {
        displayChatMessage(`Amigo: ${msg.message}`, "received");
        return;
      }
    } catch {}
  } else if (data instanceof ArrayBuffer || data instanceof Blob) {
    if (data instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => {
        archivoRecibidoBuffers.push(reader.result);
        mostrarProgresoRecepcion();
      };
      reader.readAsArrayBuffer(data);
    } else {
      archivoRecibidoBuffers.push(data);
      mostrarProgresoRecepcion();
    }
  }
}

function mostrarProgresoRecepcion() {
  let tamañoRecibido = archivoRecibidoBuffers.reduce(
    (acum, buf) => acum + buf.byteLength,
    0
  );
  const porcentaje = ((tamañoRecibido / tamañoArchivoEsperado) * 100).toFixed(
    2
  );
  status.innerText = `Recibiendo archivo: ${nombreArchivoRecibido} (${tamañoRecibido} / ${tamañoArchivoEsperado} bytes) - ${porcentaje}%`;

  if (tamañoRecibido >= tamañoArchivoEsperado && tamañoArchivoEsperado > 0) {
    const archivoBlob = new Blob(archivoRecibidoBuffers);
    const urlDescarga = URL.createObjectURL(archivoBlob);
    status.innerHTML = `Archivo recibido: <a href="${urlDescarga}" download="${nombreArchivoRecibido}">Haz clic aquí para descargar ${nombreArchivoRecibido}</a>`;
    archivoRecibidoBuffers = [];
    tamañoArchivoEsperado = 0;
    nombreArchivoRecibido = "";
    fileInput.disabled = true;
    chatInput.disabled = false;
    sendChatBtn.disabled = false;
  }
}

sendChatBtn.addEventListener("click", () => {
  const message = chatInput.value.trim();
  if (message && dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify({ type: "chat", message: message }));
    displayChatMessage(`Tú: ${message}`, "sent");
    chatInput.value = "";
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendChatBtn.click();
  }
});

function displayChatMessage(message, senderType) {
  const p = document.createElement("p");
  p.textContent = message;
  p.classList.add(senderType);
  messagesDisplay.appendChild(p);
  messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
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
    }
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registration) => {
        console.log(
          "Service Worker registrado con éxito. Scope:",
          registration.scope
        );
      })
      .catch((error) => {
        console.error("Fallo el registro del Service Worker:", error);
      });
  });
}
