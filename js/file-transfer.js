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

    window.Cudi.showToast(`Sending: ${file.name}...`, "info");
    window.Cudi.displayChatMessage(`Sending file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`, "sent", "You");

    const sendLoop = async () => {
        while (offset < file.size) {
            // Flow control check
            if (state.dataChannel.bufferedAmount > 16 * 1024 * 1024) {
                state.dataChannel.onbufferedamountlow = () => {
                    state.dataChannel.onbufferedamountlow = null;
                    sendLoop();
                };
                return;
            }

            const slice = file.slice(offset, offset + window.Cudi.CHUNK_SIZE);
            try {
                const chunk = await slice.arrayBuffer();
                state.dataChannel.send(chunk);
            } catch (err) {
                console.error("Error reading file slice:", err);
                window.Cudi.showToast("Error reading file.", "error");
                return;
            }

            offset += window.Cudi.CHUNK_SIZE;
        }

        window.Cudi.showToast("File sent successfully!", "success");
        state.archivoParaEnviar = null;
        const fileInput = document.getElementById("fileInput");
        if (fileInput) fileInput.value = "";
    };

    sendLoop();
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
