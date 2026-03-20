import { Account, Client, Databases, Storage } from 'appwrite';

const APPWRITE_DATABASE_ID = 'flashcards-db';
const APPWRITE_STORAGE_BUCKET_ID = 'card-images';
const APPWRITE_CARDS_COLLECTION_ID = 'cards';
const APPWRITE_CATEGORIES_COLLECTION_ID = 'categories';

const client = new Client()
  .setEndpoint('https://sgp.cloud.appwrite.io/v1')
  .setProject('69ad113900148316669d');

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

export {
  client,
  account,
  databases,
  storage,
  APPWRITE_DATABASE_ID,
  APPWRITE_STORAGE_BUCKET_ID,
  APPWRITE_CARDS_COLLECTION_ID,
  APPWRITE_CATEGORIES_COLLECTION_ID,
};
