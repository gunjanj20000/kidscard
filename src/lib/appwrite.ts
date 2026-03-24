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
 * Uses the preview endpoint which has better CORS support on mobile
 */
const getImagePreviewUrl = (fileId: string): string => {
  // Use preview endpoint with proper CORS and mode parameters
  // ?width=400&height=400 for reasonable image sizes
  return `${APPWRITE_ENDPOINT}/storage/buckets/${APPWRITE_STORAGE_BUCKET_ID}/files/${fileId}/preview?project=${APPWRITE_PROJECT_ID}&width=800&height=800&quality=90`;
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
