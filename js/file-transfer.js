window.Cudi.handleFileSelection = function (file) {
    const state = window.Cudi.state;
    state.archivoParaEnviar = file;

    // Basic check for size immediately
    const limitMB = parseInt(window.currentSettings?.maxFileSize || "0");
    if (limitMB > 0 && file.size > limitMB * 1024 * 1024) {
        window.Cudi.showToast(`File too large. Limit is ${limitMB}MB.`, "error");
        state.archivoParaEnviar = null;
        return;
    }

    if (state.dataChannel && state.dataChannel.readyState === "open") {
        window.Cudi.enviarArchivo();
    } else {
        state.enviarArchivoPendiente = true;
        window.Cudi.showToast(`Selected ${file.name}. Queued.`, "info");
    }
}

window.Cudi.enviarArchivo = async function () {
    const state = window.Cudi.state;
    if (!state.archivoParaEnviar) return;
    if (!state.dataChannel) return;

    const file = state.archivoParaEnviar;
    const limitMB = parseInt(window.currentSettings?.maxFileSize || "0");
    if (limitMB > 0 && file.size > limitMB * 1024 * 1024) {
        window.Cudi.showToast(`File too large. Limit is ${limitMB}MB.`, "error");
        return;
    }

    if (file.size === 0) {
        window.Cudi.showToast("Cannot send empty files.", "error");
        return;
    }

    try {
        state.dataChannel.send(JSON.stringify({
            type: "meta",
            nombre: file.name,
            tamaño: file.size,
            tipoMime: file.type,
            hash: await (async () => {
                try {
                    const buf = await file.arrayBuffer();
                    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
                    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
                } catch (e) {
                    console.error("Hashing error:", e);
                    return null;
                }
            })()
        }));
    } catch (e) {
        console.error("Error sending meta:", e);
        return;
    }

    let offset = 0;
    const CHUNK_SIZE = window.Cudi.CHUNK_SIZE || 16384;
    // Control de flujo: Límite de seguridad para evitar crash
    const MAX_BUFFERED_AMOUNT = 64 * 1024; // 64 KB
    // Importante: establecer el umbral para el evento bufferedamountlow
    state.dataChannel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2;

    window.Cudi.showToast(`Sending: ${file.name}...`, "info");
    window.Cudi.displayChatMessage(`Sending file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, "sent", "You");

    try {
        while (offset < file.size) {
            // Check connection state during loop
            if (state.dataChannel.readyState !== 'open') {
                throw new Error("Connection lost during transfer");
            }

            // Si el buffer está lleno, esperamos con timeout de seguridad
            if (state.dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                await new Promise(resolve => {
                    let resolved = false;
                    const handler = () => {
                        if (resolved) return;
                        resolved = true;
                        state.dataChannel.removeEventListener('bufferedamountlow', handler);
                        resolve();
                    };
                    state.dataChannel.addEventListener('bufferedamountlow', handler);

                    // Fallback: mobile browsers might miss the event
                    setTimeout(() => {
                        if (!resolved) {
                            // console.warn("BufferedAmountLow timeout - forcing resume"); 
                            handler();
                        }
                    }, 100);
                });
            }

            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const chunk = await slice.arrayBuffer();
            state.dataChannel.send(chunk);
            offset += CHUNK_SIZE;
        }

        window.Cudi.showToast("File sent successfully!", "success");
        state.archivoParaEnviar = null;
        const fileInput = document.getElementById("fileInput");
        if (fileInput) fileInput.value = "";

    } catch (err) {
        console.error("Error sending file:", err);
        window.Cudi.showToast("Error sending file.", "error");
    }
}

window.Cudi.processBuffer = async function (data) {
    const state = window.Cudi.state;
    state.archivoRecibidoBuffers.push(data);
    const receivedSize = state.archivoRecibidoBuffers.reduce((acc, b) => acc + b.byteLength, 0);

    if (receivedSize >= state.tamañoArchivoEsperado) {
        const ext = state.nombreArchivoRecibido.split('.').pop().toLowerCase();
        let mimeType = state.tipoMimeRecibido || '';

        // Force correct MIME types for known extensions
        const MIME_MAP = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'pdf': 'application/pdf'
        };

        if (MIME_MAP[ext]) {
            mimeType = MIME_MAP[ext];
        } else if (!mimeType) {
            mimeType = 'application/octet-stream';
        }

        const blob = new Blob(state.archivoRecibidoBuffers, { type: mimeType });

        // Integrity Check
        if (state.hashEsperado) {
            try {
                const buf = await blob.arrayBuffer();
                const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
                const calcHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

                if (calcHash !== state.hashEsperado) {
                    window.Cudi.showToast("⚠️ Integrity Check FAILED!", "error");
                    if (!confirm("Security Warning: File hash mismatch.\nThe file may be corrupted or tampered.\n\nDo you want to download it anyway?")) {
                        state.archivoRecibidoBuffers = [];
                        return;
                    }
                } else {
                    window.Cudi.showToast("✅ Integrity Verified", "success");
                }
            } catch (e) {
                console.error("Verification error", e);
            }
        }

        state.archivoRecibidoBuffers = [];

        const url = URL.createObjectURL(blob);

        window.Cudi.showToast(`File received: ${state.nombreArchivoRecibido}`, "success");
        window.Cudi.displayFileDownload(state.nombreArchivoRecibido, url, "received", "Sender");
    }
}
