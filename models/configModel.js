// models/configModel.js
class ConfigModel {
  static collectionName = 'deviceConfigs';

  // Fetch configuration for a given deviceId
  static async getConfig(db, deviceId) {
    return db.collection(this.collectionName).findOne({ deviceId });
  }

  // Fetch Onboarded Devices
  static async getOnboardedDevices(db) {
    return db.collection(this.collectionName).distinct("deviceId");
  }

  // Insert or update device configurations
  static async upsertDeviceConfigurations(db) {
    const coll = db.collection(this.collectionName);

    const configs = [
      {
        deviceId: 'officeGateway',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,  // in GB
        targetJid: '120363398262667828@g.us',
        monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        requiredContainers: ['asterisk'],
        monitoredSipContacts: ['airtel', 'jiosip-aor', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'device-ehcc',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,
        targetJid: '120363398262667828@g.us',
        monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        requiredContainers: ['asterisk'],
        monitoredSipContacts: ['airtel', 'jiosip-aor', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'device-jnu',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,
        targetJid: '120363398262667828@g.us',
        monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        requiredContainers: ['asterisk'],
        monitoredSipContacts: ['airtel', 'jiosip-aor', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'velvutech',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,  // in GB
        targetJid: '120363398262667828@g.us',
        monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        requiredContainers: ['asterisk'],
        monitoredSipContacts: ['airtel', 'jiosip-aor', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'beyoungkota',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,
        targetJid: '120363398262667828@g.us',
        monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        requiredContainers: ['asterisk'],
        monitoredSipContacts: ['airtel', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'ceramic',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,
        targetJid: '120363398262667828@g.us',
        monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        requiredContainers: ['asterisk'],
        monitoredSipContacts: ['airtel', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'matrix',
        criticalTargetJid: '120363398262667828@g.us',
        clientTargetJid: '120363398262667828@g.us',
        cpuThreshold: 50,
        diskThreshold: 75,
        ramThreshold: 80,
        freeDiskThreshold: 1,
        targetJid: '120363398262667828@g.us',
        // monitoredSips: ['airtel', 'matrix-jnu-reg', 'samwad', 'bsnl', 'cloud8002', 'samwadprod'],
        // requiredContainers: ['asterisk'],
        // monitoredSipContacts: ['airtel', 'matrix', 'matrix-jnu', 'samwad', 'bsnl', 'cloud8002', 'samwadprod']
      },
      {
        deviceId: 'hostelserver',
        thresholds: {
          "cpu_usage": {
            op: ">",
            uniOp: "decFracToPer",
            critical: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '350%',
            },
            severe: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '300%',
            },
            attention: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '50%',
            }
          },
          "memory.usedPercent": {
            op: ">",
            critical: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '20%',
            },
            severe: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '10%',
            },
            attention: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '5%',
            }
          },
          "disk.usedPercent": {
            op: ">",
            critical: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '20%',
            },
            severe: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '10%',
            },
            attention: {
              jid: '916350376868@s.whatsapp.net',
              frequency: 10,
              interval: 10,
              threshold: '5%',
            }
          },
          "docker_stats[]name.state.cpu_usage.memory_usage.memory_limit": {
            op: ["==", ">", ">"],
            uniOp: [null, "decFracToPer", null],
            critical: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10, 10],
              interval: [10, 10, 10],
              threshold: ['running', '4%', '5%'],
            },
            severe: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10, 10],
              interval: [10, 10, 10],
              threshold: ['running', '49%', '50%'],
            },
            attention: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10, 10],
              interval: [10, 10, 10],
              threshold: ['running', '49%', '50%'],
            }
          },
          "public_ip[]": {
            op: "!includes",
            attention: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10, 10],
              interval: [10, 10, 10],
              maxCount: [3, 2, 1],
              threshold: ['8.222.213.128']
            }
          },
          "local_ips[]": {
            op: "!includes",
            attention: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10, 10],
              interval: [10, 10, 10],
              maxCount: [3, 2, 1],
              threshold: ['8.222.213.128', '72.18.0.1', '72.17.0.1', '0.10.10.4'],
            },
          },
          "network[]name.bytesSent.bytesRecv.packetsSent.packetsRecv": {
            op: [">", ">"],
            uniOp: ["bandwidth", "bandwidth"],
            critical: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10],
              interval: [10, 10], 
              threshold: ['1KB/s', '1KB/s'],
            },
            severe: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10],
              interval: [10, 10],
              threshold: ['1KB/s', '1KB/s'],
            },
            attention: {
              jid: ['916350376868@s.whatsapp.net', '916350376868@s.whatsapp.net'],
              frequency: [10, 10],
              interval: [10, 10],
              threshold: ['1KB/s', '1KB/s'],
            }
          }
        }
      }
    ];

    const operations = configs.map(config => ({
      updateOne: {
        filter: { deviceId: config.deviceId },
        update: { $set: config },
        upsert: true
      }
    }));

    await coll.bulkWrite(operations);
    console.log('🔧 Inserted device configurations');
  }

}

export default ConfigModel;
