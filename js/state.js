window.Cudi = window.Cudi || {};

window.Cudi.state = {
    socket: null,
    peer: null,
    dataChannel: null,
    salaId: null,
    modo: null, // "send" | "receive"
    mensajePendiente: [],
    isRoomLocked: false,
    archivoParaEnviar: null,
    enviarArchivoPendiente: false,
    archivoRecibidoBuffers: [],
    tamañoArchivoEsperado: 0,
    nombreArchivoRecibido: "",
    heartbeatInterval: null,
    localAlias: localStorage.getItem('cudi_alias') || "You",
    remoteAlias: null,
};

// Initial settings load
let loaded = { stun: "google" };
try {
    const saved = localStorage.getItem("cudi_settings");
    if (saved) loaded = JSON.parse(saved);
} catch (e) {
    console.error("Settings parse error", e);
}
window.Cudi.LOADED_SETTINGS = loaded;

window.Cudi.STUN_SERVERS_MAP = {
    "google": [{ urls: "stun:stun.l.google.com:19302" }],
    "cloudflare": [{ urls: "stun:stun.cloudflare.com:3478" }],
    "mozilla": [{ urls: "stun:stun.services.mozilla.com" }],
    "twilio": [{ urls: "stun:global.stun.twilio.com:3478" }],
    "none": [],
    "custom": [] // Will be populated dynamically if selected
};

let settingsIce;
if (window.Cudi.LOADED_SETTINGS.stun === 'custom' && window.Cudi.LOADED_SETTINGS.customStun) {
    settingsIce = [{ urls: window.Cudi.LOADED_SETTINGS.customStun }];
} else {
    settingsIce = window.Cudi.STUN_SERVERS_MAP[window.Cudi.LOADED_SETTINGS.stun] || window.Cudi.STUN_SERVERS_MAP["google"];
}

window.Cudi.ICE_SERVERS = (typeof CONFIG !== 'undefined' && CONFIG.ICE_SERVERS)
    ? CONFIG.ICE_SERVERS
    : { iceServers: settingsIce };

window.Cudi.appType = "cudi-sync";
window.Cudi.CHUNK_SIZE = 16 * 1024;

window.Cudi.SIGNALING_SERVER_URL = (typeof CONFIG !== 'undefined' && CONFIG.SIGNALING_SERVER_URL)
    ? CONFIG.SIGNALING_SERVER_URL
    : 'wss://cudi-sync-signalin.onrender.com';
