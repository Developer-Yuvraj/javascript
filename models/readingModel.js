// models/readingModel.js
class ReadingModel {
  static collectionName = 'deviceReadings';

  static async logReading(db, reading) {
    const collection = db.collection(this.collectionName);

    //console.log('📡 Inserting reading into DB:', reading);
    await collection.insertOne(reading);

    // Keep only 2 latest readings for this device
    // const { deviceId } = reading;

    // const extraReadings = await collection
    //   .find({ deviceId })
    //   .sort({ timestamp: -1 })  // latest first
    //   .skip(2)                  // keep 2, skip rest
    //   .project({ _id: 1 })
    //   .toArray();

    // const idsToDelete = extraReadings.map(doc => doc._id);

    // if (idsToDelete.length > 0) {
    //   await collection.deleteMany({ _id: { $in: idsToDelete } });
    // }
  }
}

export default ReadingModel;
