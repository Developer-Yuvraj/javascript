// whatsapp.js

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { DisconnectReason } from "@whiskeysockets/baileys";

const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH || './whatsapp-auth';
const ADMIN_JID = process.env.WHATSAPP_ADMIN_JID || null; // optional admin to notify on max retries

let sock = null;

// Reconnect control (module scope)
let isConnecting = false;          // true while startWhatsApp is actively running
let isReconnectScheduled = false;  // true while a reconnect timer is pending
let retryCount = 0;

const MAX_RETRIES = 5;
const BASE_RECONNECT_MS = 5000; // 5s
const MAX_BACKOFF_MS = 60_000;  // 60s

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function deleteSession(sessionPath = SESSION_PATH) {
  try {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    console.log('✅ Session folder removed:', sessionPath);
  } catch (err) {
    console.error('Failed to delete session folder:', err);
  }
}

async function startWhatsApp() {
  // prevent concurrent socket starts
  if (isConnecting) {
    console.log('startWhatsApp(): already connecting — skipping duplicate call.');
    return;
  }
  isConnecting = true;

  try {
    const { state, saveCreds } = await baileys.useMultiFileAuthState(SESSION_PATH);
    const { version } = await baileys.fetchLatestBaileysVersion();

    sock = baileys.makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: [
        "Chrome",
        "Web",
        `${106 + Math.floor(Math.random() * 10)}.0.0.${Math.floor(Math.random() * 255)}`
      ],
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    // connection.update handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 Scan this QR code to connect to WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === "connecting") {
        console.log("🔄 Connecting to WhatsApp...");
      }

      if (connection === 'open') {
        // successful connect -> reset retry counter and cancel scheduled reconnects
        retryCount = 0;
        isReconnectScheduled = false;
        const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        console.log(`[${nowIST}] ✅ Connected to WhatsApp!`);
        return;
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const reasonLabel = baileys.DisconnectReason[statusCode] || statusCode || 'unknown';
        const nowIST = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        console.warn(`[${nowIST}] ❌ Disconnected. Reason: ${reasonLabel} (${statusCode})`);

        // classify codes
        const FATAL_CODES = new Set([
          DisconnectReason.badSession,
          DisconnectReason.loggedOut,
          DisconnectReason.multideviceMismatch,
          DisconnectReason.restartRequired,
          401, // auth
          406, // often unrecoverable in practice
        ]);

        const TRANSIENT_CODES = new Set([
          DisconnectReason.connectionClosed,
          DisconnectReason.connectionLost,
          DisconnectReason.connectionReplaced,
          DisconnectReason.timedOut,
          DisconnectReason.serverNotFound,
          503, // service unavailable
        ]);

        // If it's a fatal error -> stop auto reconnect and require manual intervention
        if (FATAL_CODES.has(statusCode)) {
          console.error('❌ Fatal disconnect detected. Manual intervention required.');
          console.error('Please delete auth folder and reauthenticate if needed.');
          // OPTIONAL: auto-delete session to force re-auth (commented by default)
          // deleteSession(SESSION_PATH);
          // TODO: optionally notify admin here
          return;
        }

        // For transient/unknown codes -> schedule reconnect with backoff and retry limit
        if (isReconnectScheduled) {
          console.log('Reconnect already scheduled; skipping duplicate schedule.');
          return;
        }

        if (retryCount >= MAX_RETRIES) {
          console.error(`❌ Max retries (${MAX_RETRIES}) reached. Not auto-reconnecting.`);
          // Optional admin notify (best-effort)
          if (ADMIN_JID) {
            try {
              await sendText(ADMIN_JID, `⚠️ WhatsApp monitor reached max retries (${MAX_RETRIES}). Manual intervention required.`);
            } catch (e) {
              // can't do much if send fails
              console.error('Failed to send admin notification:', e?.message || e);
            }
          }
          return;
        }

        // treat unknown as transient but limited retries
        retryCount++;
        isReconnectScheduled = true;

        const backoff = Math.min(BASE_RECONNECT_MS * Math.pow(2, retryCount - 1), MAX_BACKOFF_MS);
        console.warn(`🔁 Scheduling reconnect attempt ${retryCount}/${MAX_RETRIES} in ${backoff / 1000}s...`);

        // schedule reconnect (non-blocking)
        setTimeout(async () => {
          isReconnectScheduled = false;
          try {
            // try a graceful close of the previous socket if present
            try { sock?.ws?.close?.(); } catch (e) { /* ignore */ }

            console.log('🔄 Starting reconnect attempt...');
            await startWhatsApp();
          } catch (err) {
            console.error('Error during scheduled reconnect:', err);
          }
        }, backoff);
      }
    });

    // messages.upsert handler (keep your original logic)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const msg of messages) {
          try {
            if (!msg.key.fromMe && msg.message) {
              const senderJid = msg.key.remoteJid;
              const text = msg.message.conversation || msg.message?.extendedTextMessage?.text;
              if (text && text.toLowerCase() === 'hi') {
                await sendText(senderJid, 'Hello!, Yuvraj this side.');
              }
            }
          } catch (e) {
            console.error('Error handling incoming message:', e);
          }
        }
      }
    });
    // sleep(30000);
    return sock;
  } catch (err) {
    console.error('startWhatsApp() failed:', err);
    // If start failed while not connected, schedule a retry (respect retryCount)
    if (!isReconnectScheduled && retryCount < MAX_RETRIES) {
      retryCount++;
      const backoff = Math.min(BASE_RECONNECT_MS * Math.pow(2, retryCount - 1), MAX_BACKOFF_MS);
      console.warn(`startWhatsApp(): scheduling retry ${retryCount}/${MAX_RETRIES} in ${backoff / 1000}s`);
      isReconnectScheduled = true;
      setTimeout(async () => {
        isReconnectScheduled = false;
        await startWhatsApp();
      }, backoff);
    } else if (retryCount >= MAX_RETRIES) {
      console.error('startWhatsApp(): max retries reached after startup failures.');
      if (ADMIN_JID) {
        try { await sendText(ADMIN_JID, `⚠️ WhatsApp monitor failed to start after ${MAX_RETRIES} attempts.`); } catch { /* ignore */ }
      }
    }
  } finally {
    isConnecting = false;
  }
}

async function sendText(jid, text) {
  try {
    // If socket not present, try to start (this will be guarded by isConnecting)
    if (!sock) {
      console.warn("⚠️ WhatsApp socket missing. Attempting to start...");
      // await startWhatsApp();
    }

    // If still missing, don't try to send
    if (!sock) {
      console.error("❌ WhatsApp socket not available. Message not sent.");
      return { success: false, error: "Socket not available" };
    }

    // Send the message
    await sock.sendMessage(jid, { text });
    return { success: true };

  } catch (err) {
    console.error("❌ Failed to send message:", err.message);
    return { success: false, error: err.message };
  }
}

export { startWhatsApp, sendText };

