import express from "express";
import mqttClient from './config/mqtt.js';
import { connect as connectMongo } from './config/mongodb.js';
import { startWhatsApp, sendText } from './services/whatsapp.js';
import handleMqttMessage from './controllers/mqttController.js';
import { startMultiDeviceMonitor } from './controllers/monitorAllDevices.js';
import { checkServerHealth } from './controllers/genericChecker.js';
import fs from 'fs';
import cron from "node-cron";
import path from "path";
import multer from "multer";
import cors from "cors";
import { hostname } from "os";
import vision from "@google-cloud/vision";
import dotenv from "dotenv";
import transModel from './models/transModel.js';
import { sendSlackAlert } from "./chokidar.js";
import { sendSlackAlert1 } from "./chokidar.js";
dotenv.config();
const upload = multer(); // to parse multipart/form-data (like from FormData)

(async () => {

  // Connect to MongoDB 
  const { db, transDb } = await connectMongo();

  const app = express();
  app.use(express.json());

  app.use(express.static("public"));

  app.get("/api/readings/:deviceId", async (req, res) => {

    const { deviceId } = req.params;
    const since = new Date(req.query.start);
    const until = new Date(req.query.end);
    console.log(req.query.start, req.query.end);
    try {
      const data = await db
        .collection("deviceReadings")
        .find({
          deviceId: deviceId,
          timestamp: { $gte: since, $lte: until } // filter between since and until
        })
        .sort({ timestamp: 1 })
        .toArray();

      function getRttData(contactName) {
        return data.map(d => {
          const value = d.sipContactAvailability?.[contactName] || "";
          const match = String(value).match(/RTT:\s*([\d.]+)ms/i);
          return match ? parseFloat(match[1]) : null;
        });
      }

      const timestamps = data.map(d => d.timestamp);
      const sequence = data.map(d => Number(d.sequence));
      const airtelRtt = getRttData("airtel");
      const readings = {
        allTimestamps: [],
        allAirtelRtt: [],
        labels: []
      };
      for (let i = 0; i < sequence.length; i++) {
        readings.allTimestamps.push(new Date(timestamps[i]).toISOString());
        readings.allAirtelRtt.push(airtelRtt[i]);
        if (i < sequence.length - 1) {
          const gap =
            sequence[i + 1] - sequence[i] < 0
              ? 99999 - sequence[i] + sequence[i + 1] - 1
              : sequence[i + 1] - sequence[i] - 1;
          if (gap > 0) {
            const midPoint = new Date(
              (new Date(timestamps[i]).getTime() + new Date(timestamps[i + 1]).getTime()) / 2
            ).toISOString();
            readings.allTimestamps.push(midPoint);
            readings.allAirtelRtt.push(null);
          }
        }
      }
      console.log(readings.allAirtelRtt.length);
      console.log(readings.allTimestamps.length);
      res.json(readings);
    }
    catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use(cors());
  app.post("/submit", upload.single("signature"), async (req, res) => {
    try {
      const data = req.body;  // form fields
      const client = new vision.ImageAnnotatorClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });

      // OCR from buffer
      const [result] = await client.textDetection({
        image: { content: req?.file?.buffer }
      });
      console.log("✅ Received form data:\n", JSON.stringify(data, null, 2));
      console.log("✅ Received file:", req.file);

      const text = result.fullTextAnnotation?.text || "No text found";
      function parseTransactionText(text) {
        const normalized = text.replace(/\n/g, " ").trim();

        // 12 or 16 digit pure numeric UTR
        let utrMatch = normalized.match(/UTR:\s*(\d{12}|\d{16})/i);

        if (!utrMatch) {
          // 22-character alphanumeric UTR after "UTR:"
          utrMatch = normalized.match(/UTR:\s*(?=[A-Z0-9]{22}\b)(?=.*[A-Z])(?=.*\d)[A-Z0-9]{22}/i);
        }

        // Amount with ₹ or Rs or INR or Rupees
        const amountMatch = normalized.match(/(?:₹|INR|Rs\.?|Rupees\.?)([0-9]{1,3}(?:\.\d{1,2})?)/i);

        const dateMatch = normalized.match(
          /\b(?:\d{1,2}[:.]\d{2}\s?(?:AM|PM)\s?(?:,|on)?\s?\d{1,2}[ -]?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)[ -]?\d{2,4}|\d{1,2}[ -]?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)[ -]?\d{2,4}(?:,|\sat)?\s?\d{1,2}[:.]\d{2}\s?(?:AM|PM)?)\b/i
        );

        // Status
        const statusMatch = normalized.match(/SUCCESS|FAILED|PENDING/i);

        return {
          utr: utrMatch?.[1] || null,
          amount: amountMatch?.[1] || null,
          dateTime: dateMatch?.[1] || null,
          status: statusMatch?.[0] || null
        };
      }
      const { utr, amount, dateTime, status } = parseTransactionText(text);
      const trans = await transModel.findByUtr(transDb, utr);
      console.log(trans);
      if (trans && trans.status === "PENDING" && trans.utr === utr) {
        await transModel.paymentDone(transDb, utr);
        res.send("Transaction successful!")
      } else if (trans && trans.status === "VERIFIED" && trans.utr === utr) {
        res.send("Payment already done!")
      } else { res.send("Your payment is pending!") };
      console.log(parseTransactionText(text));
      console.log("📄 OCR Text:", text);

    } catch (err) {
      if (err.code === 11000) {
        // duplicate UTR
        return res.status(409).send("Duplicate UTR — Transaction already exists");
      } else {
        console.error("❌ Error:", err);
        res.status(500).send("OCR failed");
      }
    }
  });
  app.post("/", async (req, res) => {
    try {
      const { sender, message, timestamp } = req.body;

      if (!sender || !message || !timestamp) {
        return res.status(400).send("Missing required fields");
      }

      // 12 or 16 digit pure numeric UTR
      let utrMatch = message.match(/\b(\d{12}|\d{16})\b/);

      if (!utrMatch) {
        // 22 character alphanumeric UTR (must contain both letters & digits)
        utrMatch = message.match(/\b(?=[A-Z0-9]{22}\b)(?=.*[A-Z])(?=.*\d)[A-Z0-9]{22}\b/i);
      }

      const data = {
        sender,
        message,
        timestamp: new Date(Number(timestamp)),
        utr: utrMatch?.[0] || null,
        status: "PENDING"
      };

      await transModel.logTrans(transDb, data);
      res.status(201).send("Saved");
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Failed");
    }
  });




  app.listen(5000, "0.0.0.0", () => console.log("API running on http://localhost:5000"));

  // Seed device configurations (dynamic import for ESM)
  const configModel = await import('./models/configModel.js');
  await configModel.default.upsertDeviceConfigurations(db);

  // Initialize WhatsApp (awaits QR scan if first time)
  // await startWhatsApp();

  // parse data
  function parseAlertToJson(text, topic) {
    const lines = text.trim().split('\n');

    const getValue = (label) => {
      const line = lines.find(l => l.startsWith(label));
      //return line ? line.split(':')[1].trim() : '';
      return line ? line.substring(label.length + 1).trim() : '';
    };

    const parseSection = (sectionTitle) => {
      const section = {};
      const startIndex = lines.findIndex(line => line.includes(sectionTitle));
      if (startIndex === -1) return section;

      for (let i = startIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('-')) break;
        const [, key, value] = line.match(/- (.*?): (.*)/) || [];
        if (key && value) section[key.trim()] = value.trim();
      }
      return section;
    };

    return {
      deviceId: topic.split('/')[1] || 'unknown',
      status: 'on',

      payload: {
        sequence: getValue('Sequence'),
        ip: getValue('IP'),
        ramUsage: getValue('RAM Usage'),
        cpuUsage: getValue('CPU Usage'),
        diskUsage: getValue('Disk Usage'),
        freeDisk: getValue('Free Disk'),
        containersRunning: getValue('Containers Running'),
        sipRegistrationStatus: parseSection('SIP Registration Status'),
        sipContactAvailability: parseSection('SIP Contact Availability'),
        timestamp: getValue('Timestamp')
      }
    };
  }

  // Handle incoming MQTT messages
  mqttClient.on('message', async (topic, message) => {

    if (topic.startsWith("server/stats")) {

      function humanReadableUptime(uptimeInSeconds) {
        const days = Math.floor(uptimeInSeconds / 86400);
        const hours = Math.floor((uptimeInSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
        const seconds = uptimeInSeconds % 60;
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
      }

      let payload = JSON.parse(message.toString());
      payload = {
        ...payload,
        timestamp: new Date()
      }
      const deviceConfig = await configModel.default.getConfig(db, payload?.hostname);
      //console.dir(deviceConfig, { depth: null });
      let msgArrivalTime = new Date();
      let latency = msgArrivalTime - payload?.timestamp;

      let serverData = {
        ...payload,
        msgArrivalTime: {
          utc: msgArrivalTime,
          local: msgArrivalTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        },
        latency: latency,
        uptimeReadable: humanReadableUptime(payload?.uptime)
      }
      // console.log("Received:", serverData);
      const alerts = await checkServerHealth(payload, deviceConfig);
      let alertMessage = "";
      for (let i = alerts.length - 1; i >= 0; i--) {
        // Add server header only for last item
        if (i === alerts.length - 1) {
          alertMessage += `Server: ${alerts[i].hostname}\n`;
          alertMessage += `Running from ${alerts[i].uptime}\n`;
          alertMessage += `Time: ${new Date().toLocaleString()}\n\n`;
          continue;
        }
        const parts = (alerts[i].path).split(/[^a-zA-Z0-9]+/);
        // console.log(parts);
        const name = alerts[i]?.name;
        if (parts[0] === "network") {
          alertMessage += `Alert(${alerts[i].status})\n`;
          alertMessage += `${parts[0]}: ${name}, ${parts[1]}  Actual bandwidth ${alerts[i].actual} but bandwidth should be ${alerts[i].expected}\n\n`;
        } else if (parts[0] === "docker") {
          alertMessage += `Alert(${alerts[i].status})\n`;
          alertMessage += `Docker container: ${name}, ${parts[2]} ${parts[3] ? parts[3] : ""} Actual ${alerts[i].actual} but should be ${alerts[i].expected}\n\n`;
        } else {
          alertMessage += `Alert(${alerts[i].status})\n`;
          alertMessage += `${parts[0]} ${parts[1]} ${alerts[i].actual} but should be ${alerts[i].expected}\n\n`;
        }
      }
      // console.log(alertMessage);
      // await sendSlackAlert1(alertMessage);
       console.log("alerts:", alerts);
      // function checkServerHealth(payload, deviceConfig) {
      //   for (const key of memThres) {
      //     if (key === "usedPercent") memThres[key]
      //     if ((Array.isArray(memoryThresholds[key])) && memoryThresholds[key] < payload.memory.key) {
      //       memoryAlerts.push(`${key} memory below ${memoryThresholds[key]}: ${payload.memory.key}`);
      //     } else if (memoryThresholds[key] > payload.memory.key) {
      //       memoryAlerts.push(`${key} memory above ${memoryThresholds[key]}: ${payload.memory.key}`);
      //     }
      //   }
      // }

      // try {
      //   let uptime = humanReadableUptime(payload?.uptime);
      //   (async () => {
      //     if (payload?.load?.load1 > deviceConfig?.threshold?.load?.load1) {
      //     }
      //   })();
      // } catch {
      // }
    }

    if (topic.startsWith("docker/events")) {
      const payload = JSON.parse(message.toString());
      console.log("Received:", payload);
    }

    if (topic.startsWith("ztp/hello/")) {
      const deviceId = topic.split("/")[2];
      console.log(`👋 Hello from device: ${deviceId}`);
      const payload = JSON.parse(message.toString());
      console.log("Received:", payload);

      // 3️⃣ Build configuration dynamically
      const config = {
        type: "pjsip_config",
        data: {
          endpoint: {
            name: deviceId,
            context: "default",
            disallow: "all",
            allow: "ulaw",
            auth: `auth_${deviceId}`,
            aors: deviceId,
          },
          auth: {
            auth_type: "userpass",
            username: deviceId,
            password: "autoGenPass123", // you can randomize later
          },
          aor: {
            max_contacts: 1,
          },
          server: "sip.yourdomain.com",
        },
      };

      // 4️⃣ Publish configuration back
      const configTopic = `ztp/config/${deviceId}`;
      mqttClient.publish(configTopic, JSON.stringify(config), { qos: 1 });
      console.log(`✅ Sent config to ${configTopic}`);
    }
    else {
      const rawMessage = message.toString();
      // console.log("raw message:", rawMessage, "topic:", topic);
      try {
        const jsonData = parseAlertToJson(message.toString(), topic);
        //console.log('✅ Parsed JSON:', JSON.stringify(jsonData, null, 2));

        // Now you can pass jsonData to DB or further handling
        await handleMqttMessage(topic, jsonData, db)
          .catch(err => console.error('❌ Error handling MQTT message:', err));

      } catch (err) {
        console.error('❌ Failed to parse message:', err.message);
      }
    }
  });

  // Mark device offline 
  startMultiDeviceMonitor(db, sendText);

  async function sendKeepAlive() {

    const now = new Date();
    const formattedTime = now.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata' // Force IST
    });

    const message = `🟢 *Server Keep-Alive*
🖥️ *Server:* MonitorApp
🕒 *Time:* ${formattedTime}`;
    try {
      // await sendText('919784428342@s.whatsapp.net', message);
      await sendSlackAlert(message);
    } catch (err) {
      console.error(`❌ WhatsApp send error for Server Keep-Alive:`, err.message);
    }
  }

  // Run after a minute
  setTimeout(
    async () => {
      try {
        const now = new Date();
        const formattedTime = now.toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata' // Force IST
        });
        const message = `🟢 *Server Restarted*
🖥️ *Server:* MonitorApp
🕒 *Time:* ${formattedTime}`;
        //await sendText("919784428342@s.whatsapp.net", message);
      } catch (err) {
        console.error(`❌ WhatsApp send error for Service Restart:`, err.message);
      }
    }
    , 60 * 1000);

  // Then run every hour
  // setInterval(sendKeepAlive, 60 * 60 * 1000);

  // scheduler
  cron.schedule("0 0 * * * *", async () => {
    try {
      const offlineDevices = await db.collection('devices')
        .find({ status: "off" }, { projection: { deviceId: 1, _id: 0 } })
        .toArray();
      const message = offlineDevices.length === 0
        ? "✅ All devices are online!"
        : `*🔴 Offline Devices:*\n${offlineDevices.map(d => d.deviceId).join('\n')}`;
      // await sendText('120363398262667828@g.us', message);
      await sendSlackAlert(message);
    } catch (err) {
      console.error(`❌ WhatsApp send error for (offline) all devices`, err.message);
    }
  });

  // Make sure directory exists
  fs.mkdirSync(path.dirname("/tmp/monitor_heartbeat.txt"), { recursive: true });

  // Heartbeat writer 
  setInterval(() => {
    fs.writeFileSync("/tmp/monitor_heartbeat.txt", Date.now().toString());
  }, 60_000); // update every 60s

})();

