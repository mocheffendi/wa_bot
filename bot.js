const express = require("express");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const figlet = require("figlet");

const app = express();
app.use(express.json());

let sock;           // WhatsApp socket
let connected = false;
let currentQR = ""; // simpan QR untuk ditampilkan di browser

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth");
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false, // kita tampilkan QR via /qr
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            currentQR = qr;
            console.log("QR code updated, ready to scan.");
        }

        if (connection === "close") {
            connected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Disconnected. Reconnecting:", shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            connected = true;
            currentQR = ""; // QR sudah tidak dibutuhkan
            console.log(figlet.textSync("ZahraBot Aktif"));
            console.log("✅ WhatsApp Connected");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        console.log(`📩 ${sender}: ${text}`);

        if (text?.toLowerCase() === "halo") {
            await sock.sendMessage(sender, { text: "Halo juga dari ZahraBot! 👋" });
        }
    });
}

startBot();

// ------------------------
// EXPRESS ENDPOINTS
// ------------------------

app.get("/", (req, res) => {
    res.send("ZahraBot is running. Scan QR at <a href='/qr'>/qr</a>");
});

app.get("/qr", (req, res) => {
    if (!currentQR) return res.send("✅ QR tidak tersedia atau sudah discan.");
    res.send(`
    <html>
      <body style="text-align:center;font-family:sans-serif">
        <h2>Scan QR WhatsApp</h2>
        <img src="https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(currentQR)}&size=250x250" />
        <p>Scan pakai aplikasi WhatsApp kamu!</p>
      </body>
    </html>
  `);
});

app.get("/status", (req, res) => {
    res.json({ status: connected ? "connected" : "disconnected" });
});

app.post("/send", async (req, res) => {
    const { number, message } = req.body;

    if (!connected || !sock) {
        return res.status(400).json({ error: "❌ WhatsApp belum terhubung." });
    }

    const jid = number.includes("@s.whatsapp.net") ? number : `${number}@s.whatsapp.net`;

    try {
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, to: number });
    } catch (err) {
        console.error("❌ Gagal kirim pesan:", err);
        res.status(500).json({ error: "Gagal kirim pesan." });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Express server running on http://localhost:${PORT}`);
});
