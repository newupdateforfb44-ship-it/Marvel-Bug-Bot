const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = './sessions';

class WA {
    constructor() {
        this.sock = null;
        this.state = 'offline';
        this.stopped = false;
        this.starting = false;
        this.onMessage = null;
    }

    hasSession() {
        return fs.existsSync(path.join(SESSION_DIR, 'creds.json'));
    }

    clearSession() {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }

    closeSocket() {
        // Close the current socket without logging out, so the session files stay intact.
        if (this.sock) {
            const old = this.sock;
            this.sock = null;
            try { old.end(undefined); } catch (_) {}
        }
        this.state = 'offline';
    }

    async start(onMessage) {
        if (onMessage) this.onMessage = onMessage;
        if (this.starting) return this.sock;
        this.starting = true;
        this.stopped = false;

        try {
            const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.ubuntu('Chrome'),
                markOnlineOnConnect: false
            });

            this.sock = sock;

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', (update) => {
                // Ignore events from sockets that have already been replaced.
                if (sock !== this.sock) return;

                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    this.state = 'online';
                    console.log('💀 WHATSAPP CONNECTED SUCCESSFULLY 💀');
                } else if (connection === 'close') {
                    this.state = 'offline';
                    const code = lastDisconnect?.error?.output?.statusCode;
                    const permanent =
                        code === DisconnectReason.loggedOut ||
                        code === DisconnectReason.connectionReplaced;

                    this.sock = null;

                    if (!permanent && !this.stopped) {
                        setTimeout(() => {
                            if (!this.stopped && !this.sock) this.start(this.onMessage);
                        }, 3000);
                    }
                }
            });

            if (this.onMessage) {
                sock.ev.on('messages.upsert', this.onMessage);
            }

            return sock;
        } finally {
            this.starting = false;
        }
    }

    // Call this from WAD.js with the phone number the user typed.
    // Returns the pairing code to show the user.
    async requestPairingCode(phone) {
        const number = String(phone).replace(/\D/g, '');
        if (!number) throw new Error('Invalid phone number');
        if (this.state === 'online') throw new Error('Already connected');

        // Fresh pairing: drop any old socket and stale session files.
        this.stopped = true;
        this.closeSocket();
        this.clearSession();
        await new Promise((r) => setTimeout(r, 500));

        this.stopped = false;
        const sock = await this.start(this.onMessage);

        // Wait for the socket to open its connection before asking for a code.
        for (let i = 0; i < 50; i++) {
            if (sock?.ws?.isOpen) break;
            await new Promise((r) => setTimeout(r, 300));
        }
        if (!sock?.ws?.isOpen) throw new Error('Could not reach WhatsApp. Try again.');

        const code = await sock.requestPairingCode(number);
        return code;
    }

    async stop() {
        this.stopped = true;
        if (this.sock) {
            try {
                await this.sock.logout();
            } catch (_) {
                try { this.sock.end(undefined); } catch (_) {}
            }
        }
        this.sock = null;
        this.state = 'offline';
    }
}

module.exports = { WA };
