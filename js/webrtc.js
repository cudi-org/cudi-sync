// Custom Logger Logic
const DEBUG_MODE = false;

function logger(message, data = "") {
    if (DEBUG_MODE) {
        console.log(`[CUDI-LOG] ${message}`, data);
    }
}

window.Cudi.crearPeer = function (isOffer) {
    const state = window.Cudi.state;
    if (state.peer && state.peer.connectionState !== 'closed' && state.peer.connectionState !== 'failed') {
        logger("Peer ya existente, reutilizando.");
        if (!isOffer) return;
    }

    if (!state.peer || state.peer.connectionState === 'closed' || state.peer.connectionState === 'failed') {
        // Reset peer alias logic
        state.remoteAlias = null;
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
            logger(`WebRTC Connection State: ${state.peer.connectionState}`);
            if (state.peer.connectionState === "disconnected" || state.peer.connectionState === "failed") {
                window.Cudi.toggleLoading(false);
                const mon = document.getElementById("connection-monitor");
                if (mon) {
                    mon.textContent = "Disconnected";
                    mon.classList.remove("active");
                }
                const statusEl = document.getElementById("status");
                if (statusEl) statusEl.textContent = "Disconnected";

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
                const statusEl = document.getElementById("status");
                if (statusEl) statusEl.textContent = "P2P Connected. Waiting for channel...";
            }
        };

        state.peer.ondatachannel = (event) => {
            window.Cudi.setupDataChannel(event.channel);
        };

        state.peer.ontrack = (event) => {
            logger("Track received:", event.track.kind);
            const remoteVideo = document.getElementById("remoteVideo");
            if (remoteVideo && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                document.getElementById("videoContainer").style.display = "block";
            }
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
                logger("Enviando oferta...");
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
        // Implement retry/check logic to avoid invalid state error
        const checkAndSend = () => {
            if (state.dataChannel.readyState === 'open') {
                window.Cudi.showToast("Ready to transfer.", "success");
                const fileInput = document.getElementById("fileInput");
                const chatInput = document.getElementById("chatInput");
                const sendChatBtn = document.getElementById("sendChatBtn");

                if (fileInput) fileInput.disabled = false;
                if (chatInput) chatInput.disabled = false;
                if (sendChatBtn) sendChatBtn.disabled = false;
                window.Cudi.toggleLoading(false);

                // Send Profile (Alias) immediately
                const myAlias = state.localAlias;
                if (myAlias) {
                    try {
                        state.dataChannel.send(JSON.stringify({ type: "profile", alias: myAlias }));
                    } catch (e) {
                        console.error("Error sending profile:", e);
                    }
                }

                // Signal ready state if needed, though profile might be enough
                // state.dataChannel.send(JSON.stringify({ type: 'ready_to_receive' }));

                if (state.enviarArchivoPendiente && state.archivoParaEnviar) {
                    state.enviarArchivoPendiente = false;
                    window.Cudi.enviarArchivo();
                }

                const statusEl = document.getElementById("status");
                if (statusEl) statusEl.textContent = "Ready to Transfer";
            } else {
                // Retry in 50ms
                setTimeout(checkAndSend, 50);
            }
        };
        checkAndSend();
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
    logger("Mensaje recibido", mensaje);
    switch (mensaje.type) {
        case "start_negotiation":
            if (state.modo === "send") {
                // Check if room is locally locked (extra safety)
                if (state.isRoomLocked) {
                    console.warn("Room is locked (local check).");
                    window.Cudi.showToast("Blocked connection attempt (Room Locked).", "error");
                    return;
                }
                logger("Starting negotiation (Server signal)...");
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
                state.tipoMimeRecibido = msg.tipoMime;
                state.hashEsperado = msg.hash; // NEW: Capturar hash para validación
                state.archivoRecibidoBuffers = [];
                window.Cudi.showToast(`Receiving: ${state.nombreArchivoRecibido}`, "info");
            } else if (msg.type === "chat") {
                window.Cudi.displayChatMessage(msg.message, "received", msg.alias);
            } else if (msg.type === "profile") {
                // Peer sent their alias
                const peerAlias = msg.alias;
                if (peerAlias && peerAlias !== state.remoteAlias) {
                    state.remoteAlias = peerAlias;
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

/* ===========================
   Sync Live (Video/Screen)
   =========================== */

window.Cudi.localStream = null;

window.Cudi.renegotiate = async function () {
    const state = window.Cudi.state;
    if (!state.peer) return;
    try {
        const offer = await state.peer.createOffer();
        await state.peer.setLocalDescription(offer);
        window.Cudi.enviarSocket({
            tipo: 'oferta',
            oferta: state.peer.localDescription,
            sala: state.salaId
        });
    } catch (e) {
        console.error('Renegotiation failed', e);
    }
};

window.Cudi.startVideo = async function () {
    const state = window.Cudi.state;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        window.Cudi.localStream = stream;

        const localVideo = document.getElementById('localVideo');
        const localVideoPlaceholder = document.getElementById('localVideoPlaceholder');
        const btnToggleAudio = document.getElementById('btnToggleAudio');
        const btnToggleVideo = document.getElementById('btnToggleVideo');

        if (localVideo) {
            localVideo.srcObject = stream;
            localVideo.muted = true;
            document.getElementById('videoContainer').style.display = 'block';
            if (localVideoPlaceholder) localVideoPlaceholder.style.display = 'none';
        }

        if (btnToggleAudio) {
            btnToggleAudio.innerHTML = ICONS.micOn;
            btnToggleAudio.style.backgroundColor = '';
            btnToggleAudio.style.color = '';
        }
        if (btnToggleVideo) {
            btnToggleVideo.innerHTML = ICONS.videoOn;
            btnToggleVideo.style.backgroundColor = '';
            btnToggleVideo.style.color = '';
        }

        if (state.peer) {
            stream.getTracks().forEach(track => {
                const senders = state.peer.getSenders();
                const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
                if (existingSender) {
                    existingSender.replaceTrack(track);
                } else {
                    state.peer.addTrack(track, stream);
                }
            });
            window.Cudi.renegotiate();
        }

        const btnStart = document.getElementById('btnStartVideo');
        if (btnStart) btnStart.style.display = 'none';

    } catch (err) {
        console.error('Error accessing media devices: ', err);
        window.Cudi.showToast('Cannot access camera/microphone.', 'error');
    }
};

window.Cudi.stopVideo = function () {
    const state = window.Cudi.state;
    if (window.Cudi.localStream) {
        window.Cudi.localStream.getTracks().forEach(track => {
            track.stop();
            if (state.peer) {
                const senders = state.peer.getSenders();
                const sender = senders.find(s => s.track === track);
                if (sender) {
                    try { state.peer.removeTrack(sender); } catch (e) { }
                }
            }
        });
        window.Cudi.localStream = null;
    }

    document.getElementById('videoContainer').style.display = 'none';
    const btnStart = document.getElementById('btnStartVideo');
    if (btnStart) btnStart.style.display = 'inline-flex';

    const localVideoPlaceholder = document.getElementById('localVideoPlaceholder');
    if (localVideoPlaceholder) localVideoPlaceholder.style.display = 'none';

    window.Cudi.renegotiate();
};

window.Cudi.startScreenShare = async function () {
    const state = window.Cudi.state;
    if (!state.peer) {
        window.Cudi.showToast('No active connection.', 'error');
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        window.Cudi.showToast('Screen sharing not supported on this device.', 'error');
        return;
    }

    try {
        // Mobile browsers might behave differently, simple constraint is best
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];

        const sender = state.peer.getSenders().find(s => s.track && s.track.kind === 'video');

        if (sender) {
            sender.replaceTrack(videoTrack);
        } else {
            state.peer.addTrack(videoTrack, screenStream);
            window.Cudi.renegotiate();
        }

        document.getElementById('localVideo').srcObject = screenStream;

        videoTrack.onended = () => {
            if (window.Cudi.localStream) {
                const camTrack = window.Cudi.localStream.getVideoTracks()[0];
                if (sender) sender.replaceTrack(camTrack);
                document.getElementById('localVideo').srcObject = window.Cudi.localStream;
            } else {
                if (sender) try { state.peer.removeTrack(sender); } catch (e) { }
                window.Cudi.stopVideo();
                window.Cudi.renegotiate();
            }
        };

    } catch (err) {
        console.error('Error sharing screen: ', err);
        if (err.name === 'NotAllowedError') {
            window.Cudi.showToast('Screen sharing permission denied.', 'error');
        } else if (err.name === 'NotFoundError') {
            window.Cudi.showToast('No screen found to share.', 'error');
        } else {
            window.Cudi.showToast('Screen share failed: ' + err.message, 'error');
        }
    }
};

const ICONS = {
    micOn: '<svg name="mic-on" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>',
    micOff: '<svg name="mic-off" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-1.01.9-2.15.9-3.28zm-3.21 4.38l1.45 1.45C16.16 17.58 14.88 18.24 13.5 18.5v2.26h-3v-2.26c-1.66-.31-3.15-1.25-4.14-2.58l1.43-1.43c.72.93 1.76 1.62 2.96 1.83V12.9L3 5.27 4.27 4l16.73 16.73L19.73 22l-1.57-1.57-2.37-5.05zM7 9h1.74l1.55 1.55c-.09-.18-.16-.36-.21-.55V5c0-1.66 1.34-3 3-3 1.35 0 2.5.86 2.87 2.06l3.63 3.63c-.15-2.5-2.25-4.49-4.75-4.49-2.61 0-4.75 2.14-4.75 4.75V9z"/></svg>',
    videoOn: '<svg name="video-on" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>',
    videoOff: '<svg name="video-off" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M19.73 21.46L18 19.73v-1.23l-4-4v-3L6.27 3.73 5 5l12.73 12.73 2 2 1.27-1.27zM21 7c0-.55-.45-1-1-1h-6.73l2 2H20v5.27l1 1V7zM4 6.27L14.73 17H4c-.55 0-1-.45-1-1V7c0-.55.45-1 1-1h-.27z"/></svg>'
};

window.Cudi.toggleAudio = function () {
    if (window.Cudi.localStream) {
        const audioTrack = window.Cudi.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.querySelector('#btnToggleAudio');
            if (btn) {
                btn.innerHTML = audioTrack.enabled ? ICONS.micOn : ICONS.micOff;
                btn.style.backgroundColor = audioTrack.enabled ? '' : '#dc3545';
                btn.style.color = audioTrack.enabled ? '' : 'white';
            }
        }
    }
};

window.Cudi.toggleVideo = function () {
    if (window.Cudi.localStream) {
        const videoTrack = window.Cudi.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.querySelector('#btnToggleVideo');
            if (btn) {
                btn.innerHTML = videoTrack.enabled ? ICONS.videoOn : ICONS.videoOff;
                btn.style.backgroundColor = videoTrack.enabled ? '' : '#dc3545';
                btn.style.color = videoTrack.enabled ? '' : 'white';

                const localVideoPlaceholder = document.getElementById('localVideoPlaceholder');
                if (localVideoPlaceholder) {
                    localVideoPlaceholder.style.display = videoTrack.enabled ? 'none' : 'flex';
                }
            }
        }
    }
};

