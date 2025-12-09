class TransModel {
    static imgCollection = "matrixImages";
    static ocrCollection = "matrixOcrText";
    static filteredCollection = "matrixFiltered";
    static transCollection = "bankTrans";

    static async init(db) {
        const collection = db.collection(this.filteredCollection);
        await collection.createIndex({ utr: 1 }, { unique: true });
        console.log("UTR index ensured!");
    }

    static async findByUtr(db, utr) {
        const collection = db.collection(this.transCollection);

        const doc = await collection.findOne({ utr });
        return doc; // returns found document or null if not found
    }

    static async paymentDone(db, utr) {
        const collection = db.collection(this.transCollection);
        await collection.updateOne(
            { utr }, // find by utr
            { $set: { status: "VERIFIED" } } // update this field
        );
    }

    static async logTrans(db, trans) {
        const collection = db.collection(this.transCollection);
        console.log("📡 Inserting transaction into DB:", trans);
        await collection.insertOne(trans);
    }

    // 1️⃣ Save original image document
    static async logImage(db, imageDoc) {
        const collection = db.collection(this.imgCollection);
        console.log("🖼️ Saving Image:", imageDoc);
        await collection.insertOne(imageDoc);
    }

    // 2️⃣ Save raw OCR text document
    static async logOcr(db, ocrDoc) {
        const collection = db.collection(this.ocrCollection);
        console.log("📄 Saving OCR Text:", ocrDoc);
        await collection.insertOne(ocrDoc);
    }

    // 3️⃣ Save cleaned / extracted fields (UTR, amount, timestamp)
    static async logFiltered(db, filteredDoc) {
        const collection = db.collection(this.filteredCollection);
        console.log("🔍 Saving Filtered Data:", filteredDoc);
        await collection.insertOne(filteredDoc);
    }
}

export default TransModel;
