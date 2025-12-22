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

    try {
        state.dataChannel.send(JSON.stringify({
            type: "meta",
            nombre: file.name,
            tamaño: file.size,
            tipoMime: file.type
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
            // Si el buffer está lleno, esperamos
            if (state.dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                await new Promise(resolve => {
                    const handler = () => {
                        state.dataChannel.removeEventListener('bufferedamountlow', handler);
                        resolve();
                    };
                    state.dataChannel.addEventListener('bufferedamountlow', handler);
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

window.Cudi.processBuffer = function (data) {
    const state = window.Cudi.state;
    state.archivoRecibidoBuffers.push(data);
    const receivedSize = state.archivoRecibidoBuffers.reduce((acc, b) => acc + b.byteLength, 0);

    if (receivedSize >= state.tamañoArchivoEsperado) {
        const blob = new Blob(state.archivoRecibidoBuffers);
        state.archivoRecibidoBuffers = [];

        const url = URL.createObjectURL(blob);

        window.Cudi.showToast(`File received: ${state.nombreArchivoRecibido}`, "success");
        window.Cudi.displayFileDownload(state.nombreArchivoRecibido, url, "received", "Sender");
    }
}
