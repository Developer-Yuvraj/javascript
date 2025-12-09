// controllers/alertChecker.js

import { sendText } from '../services/whatsapp.js';
import { sendSlackAlert } from '../chokidar.js';

export async function checkAlertsForDevice(db, device, config, reading) {
  const now = new Date();
  const deviceId = reading?.deviceId;
  const alerts = {
    criticals: [],
    attentions: [],
    notifications: [],
    recoveries: []
  };

  const sipIssues = [];

  // --- Threshold intervals ---
  const NOTIF_INTERVAL = 30;
  const ALERT_INTERVAL = 15;
  const CRIT_INTERVAL = 5;

  // --- MAXCOUNT ---
  const NOTIF_MAXCOUNT = 2;
  const ALERT_MAXCOUNT = 4;
  const CRIT_MAXCOUNT = 6;

  // Use reading.timestamp if available, else fallback to now
  const eventTime = reading?.timestamp ? reading?.timestamp : now;

  const timeInIST = eventTime.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Helper functions 

  function duration(start, end) {
    const diffMs = end - start;
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    return `${mins} min ${secs} sec`;
  }

  const shouldRepeat = (last, intervalMin, currentCount = 0, maxCount = Infinity) =>
    currentCount <= maxCount && (!last || (now - new Date(last)) / 60000 >= intervalMin);

  const countIncrement = async (field) => {
    try {
      await db.collection('devices').updateOne({ deviceId }, { $inc: { [`alerts.${field}`]: 1 } })
    } catch (err) {
      console.log(err);
    }
  }

  const currentTimestamp = async (field) => {
    try {
      await db.collection('devices').updateOne({ deviceId }, { $set: { [`alerts.${field}`]: now } })
    } catch (err) {
      console.log(err);
    }
    return now;
  }

  const clearField = async (field) => {
    try { await db.collection('devices').updateOne({ deviceId }, { $unset: { [`alerts.${field}`]: '' } }); } catch (err) {
      console.log(err);
    }
  }

  // 
  async function handleSipIssue(sip, status, countKey, sinceKey, lastAlertKey, oldCountKey = undefined, oldSinceKey = undefined, oldLastAlertKey = undefined, lastAlertType = undefined) {
    if (oldSinceKey && oldLastAlertKey && lastAlertType) {
      const since = new Date(device?.alerts?.[oldSinceKey]);
      const durationStr = duration(since, now);
      sipIssues.push(`➛ *${sip.toUpperCase()}* Registration ${status} now. Previously it was ${lastAlertType} since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} (For ${durationStr}).*`);
      await clearField(oldLastAlertKey);
      await clearField(oldSinceKey);
      await clearField(oldCountKey);
      await countIncrement(countKey);
      await currentTimestamp(lastAlertKey);
      await currentTimestamp(sinceKey);
    } else {
      const last = device?.alerts?.[lastAlertKey];
      const count = device?.alerts?.[countKey] || 0;
      const since = device?.alerts?.[sinceKey] ? new Date(device?.alerts?.[sinceKey]) : await currentTimestamp(sinceKey);
      const durationStr = duration(since, now);
      if (shouldRepeat(last, ALERT_INTERVAL, count, ALERT_MAXCOUNT)) {
        sipIssues.push(
          `➛ *${sip.toUpperCase()}* Registration ${status} since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} (~${durationStr}, ongoing).`);
        await currentTimestamp(lastAlertKey);
        await countIncrement(countKey);
      }
    }
  }

  // Recovery from device offline (alerts for offline are disabled)  
  if (reading && (device?.lastOffAlert ?? false)) {
    const since = new Date(device?.lastUpdate);
    const durationStr = duration(since, now);
    alerts.recoveries.push(`*➛ Device "${deviceId}" has recovered:* Down from ${since.toLocaleTimeString(
      'en-IN',
      { timeZone: 'Asia/Kolkata' }
    )} to ${now.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
    })}, (total downtime ${durationStr}).`);
    try {
      await db.collection('devices').updateOne(
        { deviceId },
        { $unset: { lastOffAlert: '', offlineCount: '' } }
      );
    } catch (err) {
      console.error(`❌ DB unset error for ${deviceId}:`, err.message);
    }
  }

  // ========== IP Change Alert ==========
  if (device?.ip && reading?.ip && reading?.ip !== device.ip) {
    alerts.notifications.push(`*➛ IP changed:* (${device?.ip} → ${reading.ip})`);
  }

  // RAM Usage
  const ramThreshold = config.ramThreshold ?? 80;
  if (reading?.ramUsage != null) {
    const usage = parseFloat(String(reading?.ramUsage).replace('%', ''));
    if (usage > ramThreshold) {
      const last = device?.alerts?.lastRamAlert;
      const since = device?.alerts?.ramHighSince ? new Date(device?.alerts?.ramHighSince) : await currentTimestamp('ramHighSince');
      const count = device?.alerts?.ramHighCount || 0;
      const durationStr = duration(since, now);
      if (shouldRepeat(last, NOTIF_INTERVAL, count, NOTIF_MAXCOUNT)) {
        alerts.attentions.push(`*➛ RAM usage* ${usage}% *exceeds threshold* ${ramThreshold}%, (~${durationStr}, ongoing).`);
        await currentTimestamp('lastRamAlert');
        await countIncrement('ramHighCount');
      }
    } else if (device?.alerts?.lastRamAlert || device?.alerts?.ramHighSince) {
      const since = new Date(device?.alerts?.ramHighSince);
      const durationStr = duration(since, now);
      alerts.recoveries.push(`*➛ RAM usage back to normal:* High from ${since.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} to ${now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', })}, (total ${durationStr}).`);
      await clearField('lastRamAlert');
      await clearField('ramHighSince');
      await clearField('ramHighCount');
    }
  }

  // CPU Usage
  const cpuThreshold = config.cpuThreshold ?? 90;
  if (reading?.cpuUsage != null) {
    const usage = parseFloat(String(reading?.cpuUsage).replace('%', ''));
    if (usage > cpuThreshold) {
      const last = device?.alerts?.lastCpuAlert;
      const since = device?.alerts?.cpuHighSince ? new Date(device?.alerts?.cpuHighSince) : await currentTimestamp("cpuHighSince");
      const count = device?.alerts?.cpuHighCount || 0;
      const durationStr = duration(since, now);
      if (shouldRepeat(last, NOTIF_INTERVAL, count, NOTIF_MAXCOUNT)) {
        alerts.attentions.push(
          `*➛ CPU usage* ${usage}% *exceeds threshold* ${cpuThreshold}%, (~${durationStr}, ongoing).`
        );
        await currentTimestamp('lastCpuAlert');
        await countIncrement('cpuHighCount');
      }
    } else if (device?.alerts?.lastCpuAlert) {
      if (device?.alerts?.cpuHighSince) {
        const since = new Date(device?.alerts?.cpuHighSince);
        const durationStr = duration(since, now);
        alerts.recoveries.push(
          `*➛ CPU usage back to normal:* High from ${since.toLocaleTimeString(
            'en-IN',
            { timeZone: 'Asia/Kolkata' }
          )} to ${now.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
          })}, (total ${durationStr}).`
        );
      }
      await clearField('lastCpuAlert');
      await clearField('cpuHighSince');
      await clearField('cpuHighCount');
    }
  }

  // Disk Usage
  const diskThreshold = config.diskThreshold ?? 70;
  if (reading?.diskUsage != null) {
    const usage = parseFloat(String(reading?.diskUsage).replace('%', ''));
    if (usage > diskThreshold) {
      const last = device?.alerts?.lastDiskAlert;
      const since = device?.alerts?.diskHighSince ? new Date(device?.alerts?.diskHighSince) : await currentTimestamp("diskHighSince");
      const count = device?.alerts?.diskHighCount || 0;
      const durationStr = duration(since, now);
      if (shouldRepeat(last, NOTIF_INTERVAL, count, NOTIF_MAXCOUNT)) {
        if (usage > 95) {
          alerts.criticals.push(`*➛ Disk usage* ${usage}% *exceeds threshold* ${diskThreshold}%, (~${durationStr}, ongoing).`);
        } else if (usage > 85) {
          alerts.attentions.push(`*➛ Disk usage* ${usage}% *exceeds threshold* ${diskThreshold}%, (~${durationStr}, ongoing).`);
        } else {
          alerts.notifications.push(`*➛ Disk usage* ${usage}% *exceeds threshold* ${diskThreshold}%, (~${durationStr}, ongoing).`);
        } await currentTimestamp('lastDiskAlert');
        await countIncrement('diskHighCount');
      }
    } else if (device?.alerts?.lastDiskAlert) {
      if (device?.alerts?.diskHighSince) {
        const since = new Date(device?.alerts?.diskHighSince);
        const durationStr = duration(since, now);
        alerts.recoveries.push(
          `*➛ Disk usage back to normal:* High from ${since.toLocaleTimeString(
            'en-IN',
            { timeZone: 'Asia/Kolkata' }
          )} to ${now.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
          })}, (total ${durationStr}).`
        );
      }
      await clearField('lastDiskAlert');
      await clearField('diskHighSince');
      await clearField('diskHighCount');
    }
  }

  // Free Disk
  const freeDiskThreshold = config.freeDiskThreshold ?? 1;
  if (reading?.freeDisk != null) {
    let value = parseFloat(reading?.freeDisk);
    const free = /gb/i.test(reading?.freeDisk) ? value : parseFloat((value / 1024).toFixed(2));
    //const free = parseFloat(String(reading?.freeDisk).replace(/gb/i, '').trim());
    if (free < freeDiskThreshold) {
      const last = device?.alerts?.lastFreeDiskAlert;
      const since = device?.alerts?.freeDiskLowSince ? new Date(device?.alerts?.freeDiskLowSince) : await currentTimestamp("freeDiskLowSince");
      const count = device?.alerts?.freeDiskLowCount || 0;
      const durationStr = duration(since, now);
      if (shouldRepeat(last, NOTIF_INTERVAL, count, NOTIF_MAXCOUNT)) {
        if (free < 0.1) {
          alerts.criticals.push(`*➛ Free disk space* ${free}GB *is below threshold* ${freeDiskThreshold}GB, (~${durationStr}, ongoing).`);
        } else if (free < 0.5) {
          alerts.attentions.push(`*➛ Free disk space* ${free}GB *is below threshold* ${freeDiskThreshold}GB, (~${durationStr}, ongoing).`);
        } else {
          alerts.notifications.push(`*➛ Free disk space* ${free}GB *is below threshold* ${freeDiskThreshold}GB, (~${durationStr}, ongoing).`);
        } await currentTimestamp('lastFreeDiskAlert');
        await countIncrement('freeDiskLowCount');
      }
    } else if (device?.alerts?.lastFreeDiskAlert) {
      if (device?.alerts?.freeDiskLowSince) {
        const since = new Date(device?.alerts?.freeDiskLowSince);
        const durationStr = duration(since, now);
        alerts.recoveries.push(
          `*➛ Free disk space back to normal: Low from ${since.toLocaleTimeString(
            'en-IN',
            { timeZone: 'Asia/Kolkata' }
          )} to ${now.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
          })}, (total ${durationStr}).`
        );
      }
      await clearField('lastFreeDiskAlert');
      await clearField('freeDiskLowSince');
      await clearField('freeDiskLowCount');
    }
  }

  // Containers
  if (reading?.containersRunning) {
    const requiredContainers = config.requiredContainers || ['asterisk'];
    const containers = Array.isArray(reading?.containersRunning)
      ? reading?.containersRunning
      : typeof reading?.containersRunning === 'string'
        ? [reading?.containersRunning]
        : [];
    const missing = requiredContainers.filter((c) => !containers.includes(c));
    if (missing.length > 0) {
      const last = device?.alerts?.lastContainerAlert;
      const since = device?.alerts?.containerDownSince ? new Date(device?.alerts?.containerDownSince) : await currentTimestamp("containerDownSince");
      const count = device?.alerts?.containerDownCount || 0;
      const durationStr = duration(since, now);
      if (shouldRepeat(last, CRIT_INTERVAL, count, CRIT_MAXCOUNT)) {
        alerts.criticals.push(
          `*➛ Required container(s) ${missing.join(', ')} not running*, (~${durationStr}, ongoing).`
        );
        await currentTimestamp('lastContainerAlert');
        await countIncrement('containerDownCount');
      }
    } else if (device?.alerts?.lastContainerAlert) {
      if (device?.alerts?.containerDownSince) {
        const since = new Date(device?.alerts?.containerDownSince);
        const durationStr = duration(since, now);
        alerts.recoveries.push(
          `*➛ Container(s) back to normal:* Down from ${since.toLocaleTimeString(
            'en-IN',
            { timeZone: 'Asia/Kolkata' }
          )} to ${now.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
          })}, (total ${durationStr}).`
        );
      }
      await clearField('lastContainerAlert');
      await clearField('containerDownSince');
      await clearField('containerDownCount');
    }
  }

  // SIP Registration
  if (reading?.sipRegistrationStatus && Object.keys(reading.sipRegistrationStatus).length > 0) {
    if (Object.keys(reading.sipRegistrationStatus).length > 0) {
      if (device?.alerts?.lastAllSipRegStaNotAvailAlert || device?.alerts?.allSipRegStaNotAvailCount || device?.alerts?.allSipRegStaNotAvailSince) {
        const since = new Date(device?.alerts?.allSipRegStaNotAvailSince);
        const durationStr = duration(since, now);
        alerts.recoveries.push(
          `*➛ All SIP registration status available again:* Not available from ${since.toLocaleTimeString(
            'en-IN',
            { timeZone: 'Asia/Kolkata' }
          )} to ${now.toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
          })}, (total ${durationStr}).`
        );
        await clearField('lastAllSipRegStaNotAvailAlert');
        await clearField('allSipRegStaNotAvailCount');
        await clearField('allSipRegStaNotAvailSince');
      }
      const monitored = config.monitoredSips;
      let sipRecoveries = [];
      for (const [sip, status] of Object.entries(reading?.sipRegistrationStatus)) {
        if (monitored.includes(sip) && status !== 'Registered') {
          if (status === 'Rejected') {
            if (device?.alerts?.[`last${sip}RegStaNotAvailAlert`] && device?.alerts?.[`${sip}RegStaNotAvailSince`]) {
              await handleSipIssue(sip, status, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`, 'Not Avail');
            } else if (device?.alerts?.[`last${sip}RegistrationStatusUnknownAlert`] && device?.alerts?.[`${sip}RegistrationStatusUnknownSince`]) {
              await handleSipIssue(sip, status, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`, 'Unknown');
            } else if (device?.alerts?.[`last${sip}UnregAlert`] && device?.alerts?.[`${sip}UnregisteredSince`]) {
              await handleSipIssue(sip, status, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`, 'Unregistered');
            } else {
              await handleSipIssue(sip, status, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`);
            }
          } else if (status === 'Unregistered') {
            if (device?.alerts?.[`last${sip}RegStaNotAvailAlert`] && device?.alerts?.[`${sip}RegStaNotAvailSince`]) {
              await handleSipIssue(sip, status, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`, 'Not Avail');
            } else if (device?.alerts?.[`last${sip}RejAlert`] && device?.alerts?.[`${sip}RejectedSince`]) {
              await handleSipIssue(sip, status, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`, 'Rejected');
            } else if (device?.alerts?.[`last${sip}RegistrationStatusUnknownAlert`] && device?.alerts?.[`${sip}RegistrationStatusUnknownSince`]) {
              await handleSipIssue(sip, status, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`, 'Unknown');
            } else {
              await handleSipIssue(sip, status, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`)
            }
          } else if (status === '' || status === 'Not Avail') {
            if (device?.alerts?.[`last${sip}RejAlert`] && device?.alerts?.[`${sip}RejectedSince`]) {
              await handleSipIssue(sip, status, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`, 'Rejected');
            } else if (device?.alerts?.[`last${sip}UnregAlert`] && device?.alerts?.[`${sip}UnregisteredSince`]) {
              await handleSipIssue(sip, status, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`, 'Unregistered');
            } else if (device?.alerts?.[`last${sip}RegistrationStatusUnknownAlert`] && device?.alerts?.[`${sip}RegistrationStatusUnknownSince`]) {
              await handleSipIssue(sip, status, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`, 'Unknown');
            } else {
              await handleSipIssue(sip, status, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`)
            }
          } else {
            if (device?.alerts?.[`last${sip}RegStaNotAvailAlert`] && device?.alerts?.[`${sip}RegStaNotAvailSince`]) {
              await handleSipIssue(sip, status, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`, `${sip}RegStaNotAvailCount`, `${sip}RegStaNotAvailSince`, `last${sip}RegStaNotAvailAlert`, 'Not Avail');
            } else if (device?.alerts?.[`last${sip}RejAlert`] && device?.alerts?.[`${sip}RejectedSince`]) {
              await handleSipIssue(sip, status, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`, `${sip}RejectedCount`, `${sip}RejectedSince`, `last${sip}RejAlert`, 'Rejected');
            } else if (device?.alerts?.[`last${sip}UnregAlert`] && device?.alerts?.[`${sip}UnregisteredSince`]) {
              await handleSipIssue(sip, status, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`, `${sip}UnregisteredCount`, `${sip}UnregisteredSince`, `last${sip}UnregAlert`, 'Unregistered');
            } else {
              await handleSipIssue(sip, status, `${sip}RegistrationStatusUnknownCount`, `${sip}RegistrationStatusUnknownSince`, `last${sip}RegistrationStatusUnknownAlert`)
            }
          }
        } else if (monitored.includes(sip) && status === 'Registered' && (device?.alerts?.[`last${sip}RejAlert`] || device?.alerts?.[`last${sip}UnregAlert`] || device?.alerts?.[`last${sip}RegStaNotAvailAlert`] || device?.alerts?.[`last${sip}RegistrationStatusUnknownAlert`])) {
          if (device?.alerts?.[`last${sip}RejAlert`] && device?.alerts?.[`${sip}RejectedSince`]) {
            const since = new Date(device?.alerts?.[`${sip}RejectedSince`]);
            const durationStr = duration(since, now);
            sipRecoveries.push(
              `➛ *${sip.toUpperCase()}* ${status} (Rejected from ${since.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}–${now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}, ${durationStr}).`
            );

            await clearField(`last${sip}RejAlert`);
            await clearField(`${sip}RejectedCount`);
            await clearField(`${sip}RejectedSince`);

          } else if (device?.alerts?.[`last${sip}RegistrationStatusUnknownAlert`] && device?.alerts?.[`${sip}RegistrationStatusUnknownSince`]) {
            const since = new Date(device?.alerts?.[`${sip}RegistrationStatusUnknownSince`]);
            const durationStr = duration(since, now);
            sipRecoveries.push(
              `➛ *${sip.toUpperCase()}* ${status} (RegistrationStatusUnknown from ${since.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}–${now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}, ${durationStr}).`
            );

            await clearField(`last${sip}RegistrationStatusUnknownAlert`);
            await clearField(`${sip}RegistrationStatusUnknownCount`);
            await clearField(`${sip}RegistrationStatusUnknownSince`);

          } else if (device?.alerts?.[`last${sip}UnregAlert`] && device?.alerts?.[`${sip}UnregisteredSince`]) {
            const since = new Date(device?.alerts?.[`${sip}UnregisteredSince`]);
            const durationStr = duration(since, now);
            sipRecoveries.push(
              `➛ *${sip.toUpperCase()}* ${status} (Unregistered from ${since.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}–${now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}, ${durationStr}).`
            );

            await clearField(`last${sip}UnregAlert`);
            await clearField(`${sip}UnregisteredCount`);
            await clearField(`${sip}UnregisteredSince`);

          } else if (device?.alerts?.[`last${sip}RegStaNotAvailAlert`] && device?.alerts?.[`${sip}RegStaNotAvailSince`]) {
            const since = new Date(device?.alerts?.[`${sip}RegStaNotAvailSince`]);
            const durationStr = duration(since, now);
            sipRecoveries.push(
              `➛ *${sip.toUpperCase()}* ${status} (RegStaNotAvail from ${since.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}-${now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}, ${durationStr}).`
            );

            await clearField(`last${sip}RegStaNotAvailAlert`);
            await clearField(`${sip}RegStaNotAvailCount`);
            await clearField(`${sip}RegStaNotAvailSince`);

          }
        }
      }
      if (sipIssues.length > 0) {
        alerts.attentions.push(`⚠️ *SIP registration issues:*\n ${sipIssues.join('\n')}`);
      } if (sipRecoveries.length > 0) {
        alerts.recoveries.push(`✅ *SIP recoveries:*\n ${sipRecoveries.join('\n')}`)
      }
    } else {
      const since = device?.alerts?.allSipRegStaNotAvailSince ? new Date(device?.alerts?.allSipRegStaNotAvailSince) : await currentTimestamp('allSipRegStaNotAvailSince');
      const last = device?.alerts?.lastAllSipRegStaNotAvailAlert;
      const count = device?.alerts?.allSipRegStaNotAvailCount || 0;
      const durationStr = duration(since, now);
      if (shouldRepeat(last, NOTIF_INTERVAL, count, NOTIF_MAXCOUNT)) {
        alerts.criticals.push(`⚠️ *SIP registration status not available since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, (~${durationStr}, ongoing).*`)
        await currentTimestamp('lastAllSipRegStaNotAvailAlert');
        await countIncrement('allSipRegStaNotAvailCount');
      }
    }
  }

  // SIP RTT
  if (reading?.sipContactAvailability && Object.keys(reading.sipContactAvailability).length > 0) {
    const monitored = config.monitoredSipContacts;
    let rttCriticals = [];
    let rttAttentions = [];
    let rttRecoveries = [];
    for (const sip of monitored) {

      const availability = reading?.sipContactAvailability[sip];
      if (!availability) continue;

      // ✅ Check if SIP is NOT available
      if (!String(availability).includes('Avail')) {
        const last = device?.alerts?.[`lastRttNotAvail_${sip}`];
        const since = device?.alerts?.[`rttNotAvailSince_${sip}`] ? new Date(device?.alerts?.[`rttNotAvailSince_${sip}`]) : await currentTimestamp(`rttNotAvailSince_${sip}`);
        const count = device?.alerts?.[`rttNotAvailCount_${sip}`] || 0;
        const durationStr = duration(since, now);
        if (shouldRepeat(last, NOTIF_INTERVAL, count, NOTIF_MAXCOUNT)) {
          alerts.attentions.push(`*➛ ${sip.toUpperCase()} RTT:* Not Available, Since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, (~${durationStr}, ongoing).`);
          await currentTimestamp(`lastRttNotAvail_${sip}`);
          await countIncrement(`rttNotAvailCount_${sip}`);
        }
        continue;
      } else {
        const match = String(availability).match(/RTT:\s*([\d.]+)ms/i);
        if (!match) continue;
        const rtt = parseFloat(match[1]);
        if (isNaN(rtt)) continue;

        if (device?.alerts?.[`lastRttNotAvail_${sip}`] || device?.alerts?.[`rttNotAvailCount_${sip}`] || device?.alerts?.[`rttNotAvailSince_${sip}`]) {
          const since = new Date(device?.alerts?.[`rttNotAvailSince_${sip}`]);
          const durationStr = duration(since, now);
          try {
            alerts.recoveries.push(`*➛ ${sip.toUpperCase()} RTT:* Available again, Not available since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, (for ${durationStr}).`);
          } catch (err) {
            console.error(`❌ WhatsApp send error for ${deviceId}: ${sip} RTT available again`, err.message);
          } finally {
            await clearField(`lastRttNotAvail_${sip}`);
            await clearField(`rttNotAvailCount_${sip}`);
            await clearField(`rttNotAvailSince_${sip}`);
          }
        }
        let history = (device?.alerts?.sipRttHistory && device?.alerts?.sipRttHistory[sip]) || [];
        history.push({ ts: now, rtt });
        history = history.slice(-12);

        await db.collection('devices').updateOne(
          { deviceId },
          { $set: { [`alerts.sipRttHistory.${sip}`]: history } }
        );

        const last4 = history.slice(-4).map((x) => x.rtt);
        const avg4 = last4.reduce((a, b) => a + b, 0) / last4.length;
        const last8 = history.slice(-8).map((x) => x.rtt);
        const avg8 = last8.reduce((a, b) => a + b, 0) / last8.length;
        const last12 = history.slice(-12).map((x) => x.rtt);
        const avg12 = last12.reduce((a, b) => a + b, 0) / last12.length;

        if (last4.length === 4 && last4.every((x) => x > 250)) {
          const last = device?.alerts?.[`lastRttCrit_${sip}`];
          const since = device?.alerts?.[`rttCritSince_${sip}`] ? new Date(device?.alerts?.[`rttCritSince_${sip}`]) : new Date(history.at(-4)?.ts);
          const count = device?.alerts?.[`rttCritCount_${sip}`] || 0;
          if (!device?.alerts?.[`rttCritSince_${sip}`]) {
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.rttCritSince_${sip}`]: since } }
            );
          }
          const durationStr = duration(since, now);
          if (shouldRepeat(last, CRIT_INTERVAL, count, CRIT_MAXCOUNT)) {
            rttCriticals.push(`➛ *${sip.toUpperCase()} RTT:* Critical since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, (avg ${avg4.toFixed(1)}ms of last 4 stats, Critical for ${durationStr}).`);
            await currentTimestamp(`lastRttCrit_${sip}`);
            await countIncrement(`rttCritCount_${sip}`);
          }
          if (!device?.alerts?.[`rttHighSince_${sip}`]) {
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.rttHighSince_${sip}`]: since } }
            );
          }
          await clearField(`lastRttNotif_${sip}`);
          await clearField(`rttNotifSince_${sip}`);
          await clearField(`rttNotifCount_${sip}`);
          await clearField(`lastRttAlert_${sip}`);
          await clearField(`rttAlertSince_${sip}`);
          await clearField(`rttAlertCount_${sip}`);
        }

        else if (last8.length === 8 && last8.every((x) => x > 200)) {
          let interval;
          let last;
          if (device?.alerts?.[`lastRttCrit_${sip}`]) {
            last = device?.alerts?.[`lastRttCrit_${sip}`];
            interval = CRIT_INTERVAL;
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.lastRttAlert_${sip}`]: [last, interval] } }
            );
          } else {
            last = Array.isArray(device?.alerts?.[`lastRttAlert_${sip}`]) ? device?.alerts?.[`lastRttAlert_${sip}`][0] : device?.alerts?.[`lastRttAlert_${sip}`];
            interval = Array.isArray(device?.alerts?.[`lastRttAlert_${sip}`]) ? device?.alerts?.[`lastRttAlert_${sip}`][1] : ALERT_INTERVAL;
          }
          const since = device?.alerts?.[`rttAlertSince_${sip}`] ? new Date(device?.alerts?.[`rttAlertSince_${sip}`]) : new Date(history.at(-8)?.ts);
          const count = device?.alerts?.[`rttAlertCount_${sip}`] || 0;
          if (!device?.alerts?.[`rttAlertSince_${sip}`]) {
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.rttAlertSince_${sip}`]: since } }
            );
          }
          const durationStr = duration(since, now);
          if (shouldRepeat(last, interval, count, ALERT_MAXCOUNT)) {
            rttAttentions.push(`➛ *${sip.toUpperCase()} RTT:* Severe since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, (avg ${avg8.toFixed(1)}ms of last 8 stats, Severe for ${durationStr}).`);
            await currentTimestamp(`lastRttAlert_${sip}`);
            await countIncrement(`rttAlertCount_${sip}`);
          }
          if (!device?.alerts?.[`rttHighSince_${sip}`]) {
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.rttHighSince_${sip}`]: since } }
            );
          }
          await clearField(`lastRttNotif_${sip}`);
          await clearField(`rttNotifCount_${sip}`);
          await clearField(`rttNotifSince_${sip}`);
          await clearField(`lastRttCrit_${sip}`);
          await clearField(`rttCritSince_${sip}`);
          await clearField(`rttCritCount_${sip}`);
        }

        else if (last12.length === 12 && last12.every((x) => x > 150)) {
          let interval;
          let last;
          if (device?.alerts?.[`lastRttCrit_${sip}`] || device?.alerts?.[`lastRttAlert_${sip}`]) {
            last = device?.alerts?.[`lastRttCrit_${sip}`] || device?.alerts?.[`lastRttAlert_${sip}`];
            interval = device?.alerts?.[`lastRttCrit_${sip}`] ? CRIT_INTERVAL : ALERT_INTERVAL;
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.lastRttNotif_${sip}`]: [last, interval] } }
            );
          } else {
            last = Array.isArray(device?.alerts?.[`lastRttNotif_${sip}`]) ? device?.alerts?.[`lastRttNotif_${sip}`][0] : device?.alerts?.[`lastRttNotif_${sip}`];
            interval = Array.isArray(device?.alerts?.[`lastRttNotif_${sip}`]) ? device?.alerts?.[`lastRttNotif_${sip}`][1] : NOTIF_INTERVAL;
          }
          const since = device?.alerts?.[`rttNotifSince_${sip}`] ? new Date(device?.alerts?.[`rttNotifSince_${sip}`]) : new Date(history.at(-12)?.ts);
          const count = device?.alerts?.[`rttNotifCount_${sip}`] || 0;
          if (!device?.alerts?.[`rttNotifSince_${sip}`]) {
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.rttNotifSince_${sip}`]: since } }
            );
          }
          const durationStr = duration(since, now);
          if (shouldRepeat(last, interval, count, NOTIF_MAXCOUNT)) {
            rttAttentions.push(`➛ *${sip.toUpperCase()} RTT:* High since ${since.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, (avg ${avg12.toFixed(1)}ms of last 12 stats, High for ${durationStr}).`);
            await currentTimestamp(`lastRttNotif_${sip}`);
            await countIncrement(`rttNotifCount_${sip}`);
          }
          if (!device?.alerts?.[`rttHighSince_${sip}`]) {
            await db.collection('devices').updateOne(
              { deviceId },
              { $set: { [`alerts.rttHighSince_${sip}`]: since } }
            );
          }
          await clearField(`lastRttAlert_${sip}`);
          await clearField(`rttAlertSince_${sip}`);
          await clearField(`rttAlertCount_${sip}`);
          await clearField(`lastRttCrit_${sip}`);
          await clearField(`rttCritSince_${sip}`);
          await clearField(`rttCritCount_${sip}`);
        }

        else if (last12.length === 12 && last12.every((x) => x <= 150) && (device?.alerts?.[`lastRttNotif_${sip}`] || device?.alerts?.[`lastRttAlert_${sip}`] || device?.alerts?.[`lastRttCrit_${sip}`])) {
          if (device?.alerts?.[`rttNotifSince_${sip}`] || device?.alerts?.[`rttAlertSince_${sip}`] || device?.alerts?.[`rttCritSince_${sip}`]) {
            const since = new Date(device?.alerts?.[`rttHighSince_${sip}`]);
            const durationStr = duration(since, now);
            rttRecoveries.push(`➛ *${sip.toUpperCase()} RTT:* Back to normal (<=150ms), High from ${since.toLocaleTimeString(
              'en-IN',
              { timeZone: 'Asia/Kolkata' }
            )} to ${now.toLocaleTimeString('en-IN', {
              timeZone: 'Asia/Kolkata',
            })}, (total ${durationStr}).`
            );
          } else {
            alerts.push(`SIP ${sip} RTT back to normal (<=150ms)`);
          }
          await db.collection('devices').updateOne(
            { deviceId },
            {
              $unset: {
                [`alerts.lastRttNotif_${sip}`]: '',
                [`alerts.lastRttAlert_${sip}`]: '',
                [`alerts.lastRttCrit_${sip}`]: '',
                [`alerts.rttNotifSince_${sip}`]: '',
                [`alerts.rttAlertSince_${sip}`]: '',
                [`alerts.rttCritSince_${sip}`]: '',
                [`alerts.rttNotifCount_${sip}`]: '',
                [`alerts.rttAlertCount_${sip}`]: '',
                [`alerts.rttCritCount_${sip}`]: '',
                [`alerts.rttHighSince_${sip}`]: '',
              },
            }
          );
        }
      }
    } if (rttCriticals.length > 0) {
      alerts.criticals.push(`⚠️ *SIP Rtt issues:*\n ${rttCriticals.join('\n')}`);
    } if (rttAttentions.length > 0) {
      alerts.attentions.push(`⚠️ *SIP Rtt issues:*\n ${rttAttentions.join('\n')}`);
    } if (rttRecoveries.length > 0) {
      alerts.recoveries.push(`✅ *SIP Rtt recoveries:*\n ${rttRecoveries.join('\n')}`);
    }
  }

  // --- Send WhatsApp ---
  if (Object.values(alerts).some(arr => Array.isArray(arr) && arr.length > 0)) {

    let attentions = '';
    let notifications = '';
    let recoveries = '';
    let criticals = '';

    if (alerts.criticals.length > 0) {
      criticals = `*CRITICAL*\n${alerts.criticals.join('\n')}`;
      // try {
      //  const criticalMessage = `*Device:* ${deviceId.toUpperCase()}\n*Time:* ${timeInIST}\n\n${criticals}`;
      //  await sendText(config.criticalTargetJid, criticalMessage);
      // } catch (err) {
      //   console.error(`WhatsApp send error for device ${deviceId}:`, err.message);
      // }
    }
    if (alerts.attentions.length > 0) {
      attentions = `*ATTENTION*\n${alerts.attentions.join('\n')}`;
    }
    if (alerts.notifications.length > 0) {
      notifications = `*NOTIFICATION*\n${alerts.notifications.join('\n')}`;
    }
    if (alerts.recoveries.length > 0) {
      recoveries = `*RECOVERY*\n${alerts.recoveries.join('\n')}`;
    }
    const sections = [criticals, attentions, notifications, recoveries].filter(Boolean);
    const message = `*Device:* ${deviceId.toUpperCase()}\n*Time:* ${timeInIST}\n\n${sections.join('\n\n')}`;

    // let header = '*ALERT*';
    // if (alerts.some((a) => a.includes('Critical'))) {
    //   header = '*CRITICAL*';
    // }
    // else if (alerts.some((a) =>
    //   a.includes('not running') ||
    //   a.includes('OFFLINE') ||
    //   a.includes('Rejected')
    // )) {
    //   header = '*ATTENTION*';
    // }

    try {
      await sendSlackAlert(message);
      // await sendText('120363398262667828@g.us', message);
      //  await sendText(config.clientTargetJid, message);
      //  await sendText(config.criticalTargetJid, message);
    } catch (err) {
      console.error(`WhatsApp send error for device ${deviceId}:`, err.message);
    }
  }
}