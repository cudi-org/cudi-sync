const CONFIG = {
    // URL del servidor de señalización
    // En producción usar: 'wss://cudi-sync-signalin.onrender.com'
    // En desarrollo local usar: 'ws://localhost:8080'
    SIGNALING_SERVER_URL: 'wss://cudi-sync-signalin.onrender.com',
    
    // Intervalo de heartbeat en milisegundos (30 segundos)
    HEARTBEAT_INTERVAL: 30000,
    
    // Configuración ICE Servers para WebRTC
    ICE_SERVERS: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};
