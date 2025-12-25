
window.Cudi.crearPeer = function (isOffer) {
    const state = window.Cudi.state;
    if (state.peer && state.peer.connectionState !== 'closed' && state.peer.connectionState !== 'failed') {
        console.log("Peer ya existente, reutilizando.");
        if (!isOffer) return;
    }

    if (!state.peer || state.peer.connectionState === 'closed' || state.peer.connectionState === 'failed') {
        // Reset peer alias logic
        state.peerAlias = null;
        const mon = document.getElementById("connection-monitor");
        if (mon) mon.textContent = "Initializing...";

        // Dynamic load of current STUN settings
        const currentStun = window.currentSettings?.stun || "google";
        const dynamicIceServers = window.Cudi.STUN_SERVERS_MAP[currentStun] || window.Cudi.STUN_SERVERS_MAP["google"];

        state.peer = new RTCPeerConnection({ iceServers: dynamicIceServers });

        state.peer.onicecandidate = (event) => {
            if (event.candidate) {
                window.Cudi.enviarSocket({
                    tipo: "candidato",
                    candidato: event.candidate,
                    sala: state.salaId,
                });
            }
        };

        state.peer.onconnectionstatechange = () => {
            console.log(`WebRTC Connection State: ${state.peer.connectionState}`);
            if (state.peer.connectionState === "disconnected" || state.peer.connectionState === "failed") {
                window.Cudi.toggleLoading(false);
                const mon = document.getElementById("connection-monitor");
                if (mon) {
                    mon.textContent = "Disconnected";
                    mon.classList.remove("active");
                }

                if (state.modo === "receive") {
                    window.Cudi.showToast("Sender disconnected. Session ended for privacy.", "error");
                    alert("Sender disconnected. Session ended for privacy.");
                } else {
                    window.Cudi.showToast("Peer disconnected.", "error");
                }
            }
            if (state.peer.connectionState === "connected") {
                window.Cudi.showToast("Device connected!", "success");
                window.Cudi.toggleLoading(false);
                const mon = document.getElementById("connection-monitor");
                if (mon) {
                    mon.textContent = "Connected (P2P)";
                    mon.classList.add("active");
                    // Mock Latency update
                    setInterval(() => {
                        if (state.peer && state.peer.connectionState === 'connected') {
                            const latency = Math.floor(Math.random() * 20) + 10; // Mock data
                            mon.textContent = `Connected: ${latency}ms`;
                        }
                    }, 2000);
                }
            }
        };

        state.peer.ondatachannel = (event) => {
            window.Cudi.setupDataChannel(event.channel);
        };
    }

    if (isOffer) {
        if (!state.dataChannel || state.dataChannel.readyState !== 'open') {
            state.dataChannel = state.peer.createDataChannel("canalDatos");
            window.Cudi.setupDataChannel(state.dataChannel);
        }

        state.peer.createOffer()
            .then((oferta) => state.peer.setLocalDescription(oferta))
            .then(() => {
                console.log("Enviando oferta...");
                window.Cudi.enviarSocket({
                    tipo: "oferta",
                    oferta: state.peer.localDescription,
                    sala: state.salaId,
                });
            })
            .catch((error) => console.error("Error creando oferta:", error));
    }
}

window.Cudi.setupDataChannel = function (channel) {
    const state = window.Cudi.state;
    state.dataChannel = channel;
    state.dataChannel.onopen = () => {
        window.Cudi.showToast("Ready to transfer.", "success");
        const fileInput = document.getElementById("fileInput");
        const chatInput = document.getElementById("chatInput");
        const sendChatBtn = document.getElementById("sendChatBtn");

        if (fileInput) fileInput.disabled = false;
        if (chatInput) chatInput.disabled = false;
        if (sendChatBtn) sendChatBtn.disabled = false;
        window.Cudi.toggleLoading(false);

        // Send Profile (Alias) immediately
        const myAlias = localStorage.getItem("cudi_alias") || "";
        if (myAlias) {
            state.dataChannel.send(JSON.stringify({ type: "profile", alias: myAlias }));
        }

        if (state.enviarArchivoPendiente && state.archivoParaEnviar) {
            state.enviarArchivoPendiente = false;
            window.Cudi.enviarArchivo();
        }
    };
    state.dataChannel.onclose = () => {
        window.Cudi.showToast("Data channel closed.", "info");
        const fileInput = document.getElementById("fileInput");
        const chatInput = document.getElementById("chatInput");
        const sendChatBtn = document.getElementById("sendChatBtn");

        if (fileInput) fileInput.disabled = true;
        if (chatInput) chatInput.disabled = true;
        if (sendChatBtn) sendChatBtn.disabled = true;
    };
    state.dataChannel.onmessage = (event) => manejarChunk(event.data);
}

window.Cudi.manejarMensaje = function (mensaje) {
    const state = window.Cudi.state;
    const appType = window.Cudi.appType;
    console.log("Mensaje recibido:", mensaje.type, mensaje);
    switch (mensaje.type) {
        case "start_negotiation":
            if (state.modo === "send") {
                // Check if room is locally locked (extra safety)
                if (state.isRoomLocked) {
                    console.warn("Room is locked (local check).");
                    window.Cudi.showToast("Blocked connection attempt (Room Locked).", "error");
                    return;
                }
                console.log("Starting negotiation (Server signal)...");
                window.Cudi.crearPeer(true);
            } else {
                if (!state.peer) window.Cudi.crearPeer(false);
            }
            break;

        case "approval_request":
            if (state.modo === "send") {
                const peerName = mensaje.alias || "Guest";
                // Short timeout to ensure UI is ready? usually fine.
                setTimeout(() => {
                    const approved = confirm(`${peerName} wants to join. Approve?`);
                    window.Cudi.enviarSocket({
                        type: "approval_response",
                        peerId: mensaje.peerId,
                        approved: approved,
                        room: state.salaId // server might infer, but good to send
                    });
                    if (approved) {
                        window.Cudi.showToast(`Approved ${peerName}.`, "success");
                    } else {
                        window.Cudi.showToast(`Rejected ${peerName}.`, "info");
                    }
                }, 100);
            }
            break;

        case "approved":
            window.Cudi.showToast("Host approved connection! Joining...", "success");
            // Server should follow up with joined -> start_negotiation
            break;

        case "rejected":
            window.Cudi.showToast("Connection rejected by host.", "error");
            window.Cudi.toggleLoading(false);
            alert("Connection rejected by host.");
            window.location.hash = "";
            window.location.reload();
            break;

        case "signal":
            const data = mensaje.data;
            if (data.tipo === "oferta") {
                if (!state.peer) window.Cudi.crearPeer(false);
                state.peer.setRemoteDescription(new RTCSessionDescription(data.oferta))
                    .then(() => state.peer.createAnswer())
                    .then((respuesta) => state.peer.setLocalDescription(respuesta))
                    .then(() => {
                        window.Cudi.enviarSocket({
                            tipo: "respuesta",
                            respuesta: state.peer.localDescription,
                            sala: state.salaId,
                        });
                    })
                    .catch((error) => console.error("Error manejando oferta:", error));

            } else if (data.tipo === "respuesta") {
                state.peer.setRemoteDescription(new RTCSessionDescription(data.respuesta)).catch(console.error);

            } else if (data.tipo === "candidato") {
                if (state.peer) {
                    state.peer.addIceCandidate(new RTCIceCandidate(data.candidato)).catch(console.error);
                }
            }
            break;

        case "connection_rejected":
            // Fallback for old logic if server sends this
            window.Cudi.toggleLoading(false);
            window.Cudi.showToast("Connection rejected.", "error");
            alert("Connection rejected.");
            window.location.hash = "";
            window.location.reload();
            break;
    }
}

function manejarChunk(data) {
    const state = window.Cudi.state;
    if (typeof data === "string") {
        try {
            const msg = JSON.parse(data);
            if (msg.type === "meta") {
                state.nombreArchivoRecibido = msg.nombre;
                state.tamañoArchivoEsperado = msg.tamaño;
                state.archivoRecibidoBuffers = [];
                window.Cudi.showToast(`Receiving: ${state.nombreArchivoRecibido}`, "info");
            } else if (msg.type === "chat") {
                window.Cudi.displayChatMessage(msg.message, "received", msg.alias);
            } else if (msg.type === "profile") {
                // Peer sent their alias
                const peerAlias = msg.alias;
                if (peerAlias) {
                    state.peerAlias = peerAlias;
                    window.Cudi.showToast(`${peerAlias} joined the room.`, "info");
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
            reader.onload = () => window.Cudi.processBuffer(reader.result);
            reader.readAsArrayBuffer(data);
        } else {
            window.Cudi.processBuffer(data);
        }
    }
}
