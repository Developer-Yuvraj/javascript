// models/deviceModel.js
class DeviceModel {
  /**
   * Pause monitoring for a device.
   * @param {Db} db
   * @param {string} deviceId
   * @param {string} username
   */
  static async pauseMonitoring(db, deviceId, username) {
    await db.collection(this.collectionName).updateOne(
      { deviceId },
      { $set: {
          monitorPaused: true,
          pauseTime: new Date(),
          pausedBy: username,
          resumedBy: null
        }
      }
    );
  }

  /**
   * Resume monitoring for a device.
   * @param {Db} db
   * @param {string} deviceId
   * @param {string} username
   */
  static async resumeMonitoring(db, deviceId, username) {
    await db.collection(this.collectionName).updateOne(
      { deviceId },
      { $set: {
          monitorPaused: false,
          resumedBy: username
        },
        $unset: { pauseTime: '', pausedBy: '' }
      }
    );
  }
  static collectionName = 'devices';

  // Find device record by ID
  static async getDevice(db, deviceId) {
    return db.collection(this.collectionName).findOne({ deviceId });
  }

  // Insert or update device status (mark online and reset offline flag)
  static async upsertDevice(db, deviceId, data) {
    const update = {
      $set: {
        ...data,
        lastUpdate: new Date(),
        offline: false
      }
    };
    await db.collection(this.collectionName).updateOne({ deviceId }, update, { upsert: true });
  }

  // Mark device as offline (if needed by external logic)
  static async markOffline(db, deviceId) {
    await db.collection(this.collectionName).updateOne(
      { deviceId },
      { $set: { status: 'off',
        offline: true } }
    );
  }   

    // Mark device as monitored (onboarding)
    static async markMonitored(db, deviceId, name) {
      await db.collection(this.collectionName).updateOne(
        { deviceId },
        { $set: { monitored: true, name, type: 'monitored', onboardedAt: new Date() } }
      );
    }
}

export default DeviceModel;
