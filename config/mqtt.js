// config/mqtt.js

import 'dotenv/config';
import mqtt from 'mqtt';

const mqttUri = process.env.MQTT_URI;
if (!mqttUri) throw new Error('Missing MQTT_URI in .env');

const client = mqtt.connect(mqttUri, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD
});

client.on('connect', () => {
  console.log(`✅ Connected to MQTT broker at ${mqttUri}`);
  client.subscribe(process.env.MQTT_TOPIC, (err) => {
    if (err) {
      console.error('❌ MQTT subscription error:', err);
    } else {
      console.log(`ℹ️ Subscribed to topic "${process.env.MQTT_TOPIC}"`);
    }
  });
  // 1️⃣ Subscribe to hello messages
  client.subscribe("ztp/hello/+", (err) => {
    if (!err) console.log("📡 Subscribed to hello topic");
  });
  // Subscribe to Docker events 
  client.subscribe("docker/events", (err) => {
    if (!err) console.log("📡 Subscribed to docker/events topic");
  });
  // Subscribe to (server/stats) topic
  client.subscribe("server/stats", (err) => {
    if (!err) console.log("📡 Subscribed to server/stats topic");
    else console.error('❌ MQTT subscription error for server/stats:', err);
  });
});

client.on('error', (err) => {
  console.error('❌ MQTT connection error:', err);
});

export default client;
