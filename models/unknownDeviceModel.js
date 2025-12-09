// models/unknownDeviceModel.js
class UnknownDeviceModel {

    static collectionName = 'unknownDevices';

        // Insert a new unknown device
    static async addUnknownDevice(db, deviceId, data) {
      const doc = {
        deviceId,
        monitored: false,
        name: null,
        addedAt: new Date(),
        ...data,
        lastUpdate: new Date(),
        offline: false,
        type: 'unknown',
      };
      await db.collection(this.collectionName).updateOne(
        { deviceId },
        { $setOnInsert: doc },
        { upsert: true }
      );
    }

}

export default UnknownDeviceModel;