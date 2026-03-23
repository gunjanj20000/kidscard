import { Account, Client, Databases, Storage } from 'appwrite';

const APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const APPWRITE_PROJECT_ID = '69ad113900148316669d';
const APPWRITE_DATABASE_ID = 'flashcards-db';
const APPWRITE_STORAGE_BUCKET_ID = 'card-images';
const APPWRITE_CARDS_COLLECTION_ID = 'cards';
const APPWRITE_CATEGORIES_COLLECTION_ID = 'categories';

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

/**
 * Convert a file ID to its view/preview URL
 * Used for displaying images that are stored in Appwrite buckets
 */
const getImagePreviewUrl = (fileId: string): string => {
  // Use the view endpoint which works for images
  // Format: /v1/storage/buckets/{bucketId}/files/{fileId}/view
  return `${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_STORAGE_BUCKET_ID}/files/${fileId}/view?project=${APPWRITE_PROJECT_ID}`;
};

export {
  client,
  account,
  databases,
  storage,
  APPWRITE_DATABASE_ID,
  APPWRITE_STORAGE_BUCKET_ID,
  APPWRITE_CARDS_COLLECTION_ID,
  APPWRITE_CATEGORIES_COLLECTION_ID,
  getImagePreviewUrl,
};
