import { useState, useEffect, useCallback, useRef } from 'react';
import { ID, Permission, Query, Role, type Models } from 'appwrite';
import type { Category, Flashcard, SyncState } from '@/types/flashcard';
import {
  account,
  client,
  databases,
  storage as appwriteStorage,
  APPWRITE_DATABASE_ID,
  APPWRITE_CARDS_COLLECTION_ID,
  APPWRITE_CATEGORIES_COLLECTION_ID,
  APPWRITE_STORAGE_BUCKET_ID,
} from '@/lib/appwrite';
import { useOfflineStorage } from './useOfflineStorage';

export const ENABLE_CLOUD_SYNC = true;

interface SyncResult {
  success: boolean;
  error?: string;
  syncedCards?: number;
  syncedCategories?: number;
}

interface CloudCardDoc extends Models.Document {
  ownerId: string;
  word: string;
  words?: string;
  imageUrl: string;
  categoryId: string;
  createdAt: number;
  updatedAt: number;
}

interface CloudCategoryDoc extends Models.Document {
  ownerId: string;
  name: string;
  icon: string;
  color: Category['color'];
  order: number;
  createdAt: number;
  updatedAt: number;
}

const VALID_CATEGORY_COLORS: Category['color'][] = ['coral', 'mint', 'sky', 'lavender', 'sunshine', 'peach'];
const DATA_URL_PREFIX = 'data:image/';

const isDataImageUrl = (value: string) => value.startsWith(DATA_URL_PREFIX);

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = blob.type.split('/')[1] || 'png';
  return new File([blob], `${fileName}.${extension}`, { type: blob.type || 'image/png' });
};

const mapCardDocToLocal = (doc: CloudCardDoc): Flashcard => ({
  id: doc.$id,
  word: String(doc.word ?? doc.words ?? ''),
  imageUrl: String(doc.imageUrl ?? ''),
  categoryId: String(doc.categoryId ?? ''),
  createdAt: typeof doc.createdAt === 'number' ? doc.createdAt : Date.now(),
  updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now(),
  syncStatus: 'synced',
});

const mapCategoryDocToLocal = (doc: CloudCategoryDoc): Category => {
  const color = String(doc.color ?? 'coral') as Category['color'];

  return {
    id: doc.$id,
    name: String(doc.name ?? ''),
    icon: String(doc.icon ?? '📚'),
    color: VALID_CATEGORY_COLORS.includes(color) ? color : 'coral',
    order: typeof doc.order === 'number' ? doc.order : 0,
    createdAt: typeof doc.createdAt === 'number' ? doc.createdAt : Date.now(),
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now(),
    syncStatus: 'synced',
  };
};

const createPermissions = (userId: string) => [
  Permission.read(Role.user(userId)),
  Permission.update(Role.user(userId)),
  Permission.delete(Role.user(userId)),
];

const sortCategories = (items: Category[]) =>
  [...items].sort((a, b) => {
    const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });

const isQueryCompatibilityError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('query') &&
    (
      message.includes('attribute') ||
      message.includes('index') ||
      message.includes('invalid')
    )
  );
};

const UNKNOWN_ATTRIBUTE_REGEX = /Unknown attribute:\s*"([^"]+)"/i;
const INVALID_FIELD_REGEX = /Invalid field:\s*"([^"]+)"/i;

const getUnknownAttribute = (error: unknown): string | null => {
  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message;
  
  // Try multiple patterns for finding problematic attribute
  let match = message.match(UNKNOWN_ATTRIBUTE_REGEX);
  if (match?.[1]) return match[1];
  
  match = message.match(INVALID_FIELD_REGEX);
  if (match?.[1]) return match[1];
  
  // Log the full error for debugging unknown formats
  if (message.includes('400') || message.includes('Bad Request')) {
    console.error('Appwrite 400 error (unparsed):', message);
  }
  
  return null;
};

const isNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes('404') || error.message.toLowerCase().includes('not found');
};

export function useFlashcardSync() {
  const storage = useOfflineStorage();
  const {
    getPendingCards,
    getPendingCategories,
    saveAllCategories,
    saveAllCards,
    getAllCards,
    getAllCategories,
    saveImage,
  } = storage;
  const [user, setUser] = useState<Models.User<Models.Preferences> | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({
    lastSyncedAt: null,
    isSyncing: false,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingChanges: 0,
  });
  const realtimePullTimer = useRef<number | null>(null);

  const updatePendingCount = useCallback(async () => {
    const pendingCards = await getPendingCards();
    const pendingCategories = await getPendingCategories();
    const nextPendingChanges = pendingCards.length + pendingCategories.length;
    setSyncState((prev) => {
      if (prev.pendingChanges === nextPendingChanges) {
        return prev;
      }

      return {
        ...prev,
        pendingChanges: nextPendingChanges,
      };
    });
  }, [getPendingCards, getPendingCategories]);

  const getCurrentUser = useCallback(async () => {
    try {
      const currentUser = await account.get();
      setUser(currentUser);
      return currentUser;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const listAllDocuments = useCallback(async <T extends Models.Document>(collectionId: string, userId: string) => {
    const allDocs: T[] = [];
    let cursor: string | undefined;
    let useOwnerFilter = true;

    while (true) {
      const queries = [Query.limit(100)];
      if (useOwnerFilter) {
        queries.unshift(Query.equal('ownerId', userId));
      }

      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      }

      let response: Models.DocumentList<T>;
      try {
        response = await databases.listDocuments<T>(APPWRITE_DATABASE_ID, collectionId, queries);
      } catch (error) {
        if (useOwnerFilter && isQueryCompatibilityError(error)) {
          // Some Appwrite setups reject this filter when the attribute/index is missing.
          useOwnerFilter = false;
          allDocs.length = 0;
          cursor = undefined;
          continue;
        }

        throw error;
      }

      allDocs.push(...response.documents);

      if (response.documents.length < 100) {
        break;
      }

      cursor = response.documents[response.documents.length - 1].$id;
    }

    if (useOwnerFilter) {
      return allDocs;
    }

    return allDocs.filter((doc) => {
      const ownerId = (doc as { ownerId?: unknown }).ownerId;
      return typeof ownerId !== 'string' || ownerId === userId;
    });
  }, []);

  const pullFromCloud = useCallback(async (): Promise<SyncResult> => {
    if (!ENABLE_CLOUD_SYNC) {
      return { success: false, error: 'Cloud sync is disabled.' };
    }

    const currentUser = user ?? (await getCurrentUser());
    if (!currentUser) {
      return { success: false, error: 'Please log in first.' };
    }

    setSyncState((prev) => ({ ...prev, isSyncing: true }));

    try {
      const [remoteCardDocs, remoteCategoryDocs] = await Promise.all([
        listAllDocuments<CloudCardDoc>(APPWRITE_CARDS_COLLECTION_ID, currentUser.$id),
        listAllDocuments<CloudCategoryDoc>(APPWRITE_CATEGORIES_COLLECTION_ID, currentUser.$id),
      ]);

      const remoteCategories = sortCategories(remoteCategoryDocs.map(mapCategoryDocToLocal));
      const remoteCards = remoteCardDocs.map(mapCardDocToLocal);

      await Promise.all([
        saveAllCategories(remoteCategories),
        saveAllCards(remoteCards),
      ]);

      setSyncState((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: Date.now(),
      }));

      await updatePendingCount();

      return {
        success: true,
        syncedCards: remoteCards.length,
        syncedCategories: remoteCategories.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pull from cloud.';
      setSyncState((prev) => ({ ...prev, isSyncing: false }));
      return { success: false, error: message };
    }
  }, [getCurrentUser, listAllDocuments, saveAllCards, saveAllCategories, updatePendingCount, user]);
  const uploadImage = useCallback(async (cardId: string, imageData: string): Promise<string | null> => {
    await saveImage(cardId, imageData);

    if (!isDataImageUrl(imageData)) {
      return imageData;
    }

    const currentUser = user ?? (await getCurrentUser());
    if (!currentUser) {
      return imageData;
    }

    try {
      const file = await dataUrlToFile(imageData, cardId);
      const permissions = createPermissions(currentUser.$id);

      try {
        await appwriteStorage.deleteFile(APPWRITE_STORAGE_BUCKET_ID, cardId);
      } catch {
        // Ignore if file does not exist yet.
      }

      await appwriteStorage.createFile(APPWRITE_STORAGE_BUCKET_ID, cardId, file, permissions);
      return appwriteStorage.getFilePreview(APPWRITE_STORAGE_BUCKET_ID, cardId).toString();
    } catch (error) {
      console.error('Image upload failed:', error);
      return imageData;
    }
  }, [getCurrentUser, saveImage, user]);

  const deleteImageFromCloud = useCallback(async (cardId: string): Promise<void> => {
    const currentUser = user ?? (await getCurrentUser());
    if (!currentUser) {
      return;
    }

    try {
      await appwriteStorage.deleteFile(APPWRITE_STORAGE_BUCKET_ID, cardId);
    } catch {
      // Ignore if file does not exist or cannot be removed right now.
    }
  }, [getCurrentUser, user]);
  const syncToCloud = useCallback(async (): Promise<SyncResult> => {
    if (!ENABLE_CLOUD_SYNC) {
      return { success: false, error: 'Cloud sync is disabled.' };
    }

    const currentUser = user ?? (await getCurrentUser());
    if (!currentUser) {
      return { success: false, error: 'Please log in first.' };
    }

    setSyncState((prev) => ({ ...prev, isSyncing: true }));

    try {
      const [localCards, localCategories, remoteCardDocs, remoteCategoryDocs] = await Promise.all([
        getAllCards(),
        getAllCategories(),
        listAllDocuments<CloudCardDoc>(APPWRITE_CARDS_COLLECTION_ID, currentUser.$id),
        listAllDocuments<CloudCategoryDoc>(APPWRITE_CATEGORIES_COLLECTION_ID, currentUser.$id),
      ]);

      const cardsWithResolvedImageUrls = await Promise.all(
        localCards.map(async (card) => {
          if (!isDataImageUrl(card.imageUrl)) {
            return card;
          }

          const uploadedUrl = await uploadImage(card.id, card.imageUrl);
          if (!uploadedUrl || uploadedUrl === card.imageUrl) {
            return card;
          }

          return {
            ...card,
            imageUrl: uploadedUrl,
            updatedAt: Date.now(),
            syncStatus: 'pending' as const,
          };
        })
      );

      const localCardsChanged = cardsWithResolvedImageUrls.some(
        (card, index) => card.imageUrl !== localCards[index]?.imageUrl
      );
      const effectiveLocalCards = localCardsChanged ? cardsWithResolvedImageUrls : localCards;

      if (localCardsChanged) {
        await saveAllCards(effectiveLocalCards);
      }

      const permissions = createPermissions(currentUser.$id);
      const localCardIds = new Set(effectiveLocalCards.map((card) => card.id));
      const localCategoryIds = new Set(localCategories.map((category) => category.id));

      const upsertDocumentWithSchemaFallback = async (
        collectionId: string,
        documentId: string,
        basePayload: Record<string, unknown>
      ) => {
        let payload: Record<string, unknown> = { ...basePayload };

        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            await databases.updateDocument(
              APPWRITE_DATABASE_ID,
              collectionId,
              documentId,
              payload
            );
            return;
          } catch (updateError) {
            // Check if document doesn't exist (404) - should trigger CREATE
            if (isNotFoundError(updateError)) {
              try {
                await databases.createDocument(
                  APPWRITE_DATABASE_ID,
                  collectionId,
                  documentId,
                  payload,
                  permissions
                );
                return;
              } catch (createError) {
                const createUnknownAttribute = getUnknownAttribute(createError);
                if (createUnknownAttribute && createUnknownAttribute in payload) {
                  const { [createUnknownAttribute]: _removed, ...nextPayload } = payload;
                  payload = nextPayload;
                  continue;
                }
                throw createError;
              }
            }

            // Check for unknown attributes on UPDATE
            const updateUnknownAttribute = getUnknownAttribute(updateError);
            if (updateUnknownAttribute && updateUnknownAttribute in payload) {
              const { [updateUnknownAttribute]: _removed, ...nextPayload } = payload;
              payload = nextPayload;
              continue;
            }

            // Any other error on UPDATE (non-404, non-unknown-attribute) - try CREATE
            try {
              await databases.createDocument(
                APPWRITE_DATABASE_ID,
                collectionId,
                documentId,
                payload,
                permissions
              );
              return;
            } catch (createError) {
              const createUnknownAttribute = getUnknownAttribute(createError);
              if (createUnknownAttribute && createUnknownAttribute in payload) {
                const { [createUnknownAttribute]: _removed, ...nextPayload } = payload;
                payload = nextPayload;
                continue;
              }

              throw createError;
            }
          }
        }

        throw new Error('Failed to sync document due to incompatible Appwrite schema.');
      };

      await Promise.all(localCategories.map(async (category) => {
        const payload = {
          ownerId: currentUser.$id,
          isActive: true,
          name: category.name,
          icon: category.icon,
          color: category.color,
        };

        await upsertDocumentWithSchemaFallback(
          APPWRITE_CATEGORIES_COLLECTION_ID,
          category.id,
          payload
        );
      }));

      await Promise.all(effectiveLocalCards.map(async (card) => {
        const payload = {
          ownerId: currentUser.$id,
          word: card.word,
          imageId: card.imageUrl,
          categoryId: card.categoryId,
        };

        await upsertDocumentWithSchemaFallback(
          APPWRITE_CARDS_COLLECTION_ID,
          card.id,
          payload
        );
      }));

      await Promise.all(remoteCardDocs
        .filter((doc) => !localCardIds.has(doc.$id))
        .map(async (doc) => {
          await databases.deleteDocument(APPWRITE_DATABASE_ID, APPWRITE_CARDS_COLLECTION_ID, doc.$id);
          try {
            await appwriteStorage.deleteFile(APPWRITE_STORAGE_BUCKET_ID, doc.$id);
          } catch {
            // Ignore missing files.
          }
        })
      );

      await Promise.all(remoteCategoryDocs
        .filter((doc) => !localCategoryIds.has(doc.$id))
        .map((doc) => databases.deleteDocument(APPWRITE_DATABASE_ID, APPWRITE_CATEGORIES_COLLECTION_ID, doc.$id))
      );

      const syncedCards = effectiveLocalCards.map((card) => ({ ...card, syncStatus: 'synced' as const }));
      const syncedCategories = localCategories.map((category) => ({
        ...category,
        syncStatus: 'synced' as const,
      }));

      await Promise.all([
        saveAllCards(syncedCards),
        saveAllCategories(syncedCategories),
      ]);

      setSyncState((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncedAt: Date.now(),
      }));

      await updatePendingCount();

      return {
        success: true,
        syncedCards: syncedCards.length,
        syncedCategories: syncedCategories.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync to cloud.';
      setSyncState((prev) => ({ ...prev, isSyncing: false }));
      return { success: false, error: message };
    }
  }, [
    getAllCards,
    getAllCategories,
    getCurrentUser,
    listAllDocuments,
    saveAllCards,
    saveAllCategories,
    uploadImage,
    updatePendingCount,
    user,
  ]);

  const fullSync = useCallback(async (): Promise<SyncResult> => {
    const push = await syncToCloud();
    if (!push.success) {
      return push;
    }

    return pullFromCloud();
  }, [pullFromCloud, syncToCloud]);

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await account.createEmailPasswordSession(email, password);
      const currentUser = await account.get();
      setUser(currentUser);
      await fullSync();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Login failed' };
    }
  }, [fullSync]);

  const signup = useCallback(async (
    name: string,
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await account.create(ID.unique(), email, password, name);
      await account.createEmailPasswordSession(email, password);
      const currentUser = await account.get();
      setUser(currentUser);
      await fullSync();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Sign up failed' };
    }
  }, [fullSync]);

  const logout = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await account.deleteSession('current');
      setUser(null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Logout failed' };
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setSyncState((prev) => ({ ...prev, isOnline: true }));
    };

    const handleOffline = () => {
      setSyncState((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    void getCurrentUser();
    void updatePendingCount();
  }, [getCurrentUser, updatePendingCount]);

  useEffect(() => {
    if (!ENABLE_CLOUD_SYNC || !user) {
      return;
    }

    const unsubscribe = client.subscribe([
      `databases.${APPWRITE_DATABASE_ID}.collections.${APPWRITE_CARDS_COLLECTION_ID}.documents`,
      `databases.${APPWRITE_DATABASE_ID}.collections.${APPWRITE_CATEGORIES_COLLECTION_ID}.documents`,
    ], () => {
      if (realtimePullTimer.current !== null) {
        window.clearTimeout(realtimePullTimer.current);
      }

      realtimePullTimer.current = window.setTimeout(() => {
        realtimePullTimer.current = null;
        void pullFromCloud();
      }, 350);
    });

    return () => {
      if (realtimePullTimer.current !== null) {
        window.clearTimeout(realtimePullTimer.current);
      }
      unsubscribe();
    };
  }, [pullFromCloud, user]);

  return {
    syncState,
    syncToCloud,
    pullFromCloud,
    fullSync,
    uploadImage,
    updatePendingCount,
    isEnabled: ENABLE_CLOUD_SYNC && !!user,
    user,
    login,
    signup,
    logout,
    getCurrentUser,
    deleteImageFromCloud,
  };
}
