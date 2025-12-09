// controllers/monitorAllDevices.js
import DeviceModel from '../models/deviceModel.js';
import ConfigModel from '../models/configModel.js';
import { sendSlackAlert } from '../chokidar.js';

// Helper functions
async function updateLastAlert(db, deviceId, field) {
  await db.collection('devices').updateOne(
    { deviceId },
    { $set: { [field]: new Date() } }
  );
}

// const countIncrement = async (db, deviceId, field) => {
//   try {
//     await db.collection('devices').updateOne({ deviceId }, { $inc: { [field]: 1 } })
//   } catch (err) {
//     console.log(err);
//   }
// }

const clearField = async (db, deviceId, field) => {
  try { await db.collection('devices').updateOne({ deviceId }, { $unset: { [field]: '' } }); } catch (err) {
    console.log(err);
  }
}

// --- Helper for repeated alerting ---
// const shouldRepeat = (last, currentCount = 0, maxCount = 8, intervalMin = 5, intervalMax = 60) => {
//   const now = new Date();
//   const count = currentCount - 1;
//   const backoffInterval = Math.max(
//     intervalMin,
//     Math.min(intervalMin * Math.pow(2, count - 1), intervalMax)
//   );
//   return currentCount <= maxCount && (!last || (now - new Date(last)) / 60000 >= backoffInterval);
// }

export async function startMultiDeviceMonitor(db, sendText) {
  setTimeout(() => {
    setInterval(async () => {
      const now = new Date();
      try {
        const devices = await db.collection('devices').find({}).toArray();
        for (const device of devices) {
          const notUpdatedSince = new Date(device.lastUpdate);
          if (now - notUpdatedSince >= 3 * 60 * 1000) {
            if (!device?.lastOffAlert) {
              //const currentCount = device?.offlineCount || 0;
              //const last = device?.lastOffAlert;
              const deviceId = device.deviceId;
              const config = await ConfigModel.getConfig(db, deviceId);
              const downMinutes = Math.floor((now - notUpdatedSince) / 60000);
              await DeviceModel.markOffline(db, deviceId);
              await clearField(db, deviceId, 'alerts');
              const msg = `*Device "${deviceId}" is* *OFFLINE:*\n` +
                `[from ${notUpdatedSince.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} to ${now.toLocaleTimeString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                })}],\n` +
                `(offline for ${downMinutes} min).`;
              try {
                // await sendText(config.targetJid, msg);
                await sendSlackAlert(msg);
                await updateLastAlert(db, deviceId, 'lastOffAlert');
              } catch (err) {
                console.error(`❌ WhatsApp send error for (offline) single device`, err.message);
              }
            }
            // if (shouldRepeat(last, currentCount)) {
            //   if (currentCount >= 6) {
            //     offlineDevices.push(`*➛ Device "${deviceId}" is* *OFFLINE:*\n` +
            //       `[from ${notUpdatedSince.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} to ${now.toLocaleTimeString('en-IN', {
            //         timeZone: 'Asia/Kolkata',
            //       })}],\n` +
            //       `(offline for ${downMinutes} min).`);
            //   } else {
            //     try {
            //       const msg = `*Device "${deviceId}" is* *OFFLINE:*\n` +
            //         `[from ${notUpdatedSince.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} to ${now.toLocaleTimeString('en-IN', {
            //           timeZone: 'Asia/Kolkata',
            //         })}],\n` +
            //         `(offline for ${downMinutes} min).`;

            //       await sendText(config.targetJid, msg);
            //     } catch (err) {
            //       console.error(`❌ WhatsApp send error for (offline) single device`, err.message);
            //     }
            //   }
            //   await countIncrement(db, deviceId, 'offlineCount');
            //   await updateLastAlert(db, deviceId, 'lastOffAlert');
            // }
          }
        }
      } catch (err) {
        console.error('Error during loop:', err.message);
      }
    }, 10000); // Every ten second
  }, 2 * 60 * 1000 + 50 * 1000);
}

