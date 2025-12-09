// config/mongodb.js

import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Missing MONGODB_URI in .env');
const client = new MongoClient(uri);

async function connect() {
  await client.connect();
  console.log('✅ Connected to MongoDB');
 // return client.db(process.env.DB_NAME || client.db().databaseName);

  const db = client.db(process.env.DB_NAME);
  const transDb = client.db("matrixTransDB");

  return { db, transDb };

}

export { client, connect };
