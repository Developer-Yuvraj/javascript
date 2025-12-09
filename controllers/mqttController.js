// controllers/mqttController.js

import ConfigModel from '../models/configModel.js';
import DeviceModel from '../models/deviceModel.js';
import ReadingModel from '../models/readingModel.js';
import { checkAlertsForDevice } from './alertController.js';
import { sendText } from '../services/whatsapp.js';
import { sendSlackAlert } from '../chokidar.js';

/**
 * Handle incoming MQTT messages for IoT devices.
 * Parses the payload, validates the device, logs readings, updates device status, and triggers alerts.
 */

export default async function handleMqttMessage(topic, message, db) {

  let data;
  try {
    data = message;
  } catch (err) {
    console.error('❌ Error parsing MQTT message JSON:', err);
    return;
  }
  // Determine deviceId (either from message or topic wildcard)
  let deviceId = data.deviceId || (topic.split('/')[1]) || 'unknown';

  // Get previous device data from DB for comparisons
  let prevDevice = await DeviceModel.getDevice(db, deviceId);

  //   // Add as unknown device, Store stats for last 10 minutes (in a capped array) and Send notification about unknown device
  //   
  //   isUnknown = true;
  //   
  //   const msg = `*ATTENTION: Unknown Device Detected!*\n*Time:* ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n*Device ID:* ${deviceId}\nA new device has sent stats to the server. Please review and add this device to monitoring if genuine, or remove if not.`;
  //   await sendText(process.env.WHATSAPP_ADMIN_JID, msg);
  //   await db.collection('devices').updateOne(
  //     { deviceId },
  //     { $push: { lastStats: { $each: [data], $slice: -10 } } }
  //   );
  //   return;
  // }

  // If device is unknown but now monitored (onboarded via frontend) then Send onboarding notification
  // if (prevDevice && prevDevice.type === 'unknown' && prevDevice.monitored) {
  //   const now = new Date();
  //   const msg = `*Device Onboarded!*\n*Time:* ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n*Device ID:* ${deviceId}\nDevice has been added to monitoring.\nDevice Info: ${JSON.stringify(prevDevice, null, 2)}`;
  //   await sendText(process.env.WHATSAPP_ADMIN_JID, msg);
  //   // Update type to monitored
  // }

  // Retrieve device configuration (thresholds, WhatsApp target)
  const config = await ConfigModel.getConfig(db, deviceId);
  if (!config) {
    console.warn(`⚠️ No configuration found for device "${deviceId}". Skipping message.`);
    return;
  }

  // Extract relevant payload data (nested payload object expected)
  const payload = data.payload || {};
  const { sequence, ip, ramUsage, cpuUsage, diskUsage, freeDisk, containersRunning, sipRegistrationStatus, sipContactAvailability, timestamp } = payload;
  const status = data.status;

  // Log the raw reading to MongoDB
  const reading = {
    sequence,
    deviceId,
    status,
    ip,
    ramUsage,
    cpuUsage,
    diskUsage,
    freeDisk,
    containersRunning,
    sipRegistrationStatus,
    sipContactAvailability,
    timestamp: new Date(timestamp.replace(" ", "T") + "+05:30")
  };

  const onboardedDevices = await ConfigModel.getOnboardedDevices(db);
  if (!onboardedDevices.includes(deviceId)) {
    const now = new Date();
    const msg = `*ATTENTION: Unknown Device Detected!*\n*Time:* ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n*Device ID:* ${deviceId}\nA new device has sent stats to the server. Please review and add this device to monitoring if genuine, or remove if not.`;
    // await sendText(process.env.WHATSAPP_ADMIN_JID, msg);
    await sendSlackAlert(msg);
    await DeviceModel.addUnknownDevice(db, deviceId, { lastStats: [] });
    console.warn(`⚠️ Unknown Device Detected: "${deviceId}". Skipping message.`);
    return;
  }

  await checkAlertsForDevice(db, prevDevice, config, reading);

  await ReadingModel.logReading(db, reading);

  // Update device record in DB (set latest readings and status, mark online)
  await DeviceModel.upsertDevice(db, deviceId, {
    ip,
    status,
    cpuUsage,
    ramUsage,
    diskUsage,
    freeDisk,
    containersRunning,
    sipRegistrationStatus,
    sipContactAvailability
  });
};
