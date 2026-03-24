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
  getImagePreviewUrl,
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
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

const isDataImageUrl = (value: string) => value.startsWith(DATA_URL_PREFIX);

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  
  // Always use .jpg for JPEG images - strict extension enforcement
  let extension = 'png'; // Default fallback
  
  if (blob.type === 'image/svg+xml') {
    extension = 'svg';
  } else if (blob.type === 'image/jpeg' || blob.type === 'image/jpg') {
    extension = 'jpg'; // Always normalize to jpg
  } else if (blob.type === 'image/png') {
    extension = 'png';
  } else if (blob.type === 'image/gif') {
    extension = 'gif';
  } else if (blob.type === 'image/webp') {
    extension = 'webp';
  } else if (blob.type.includes('/')) {
    // Fallback extraction from MIME type
    const extracted = blob.type.split('/')[1]?.split(';')[0] || 'png';
    // Normalize any jpeg variant to jpg
    extension = extracted === 'jpeg' ? 'jpg' : extracted;
  }
  
  return new File([blob], `${fileName}.${extension}`, { type: blob.type || 'image/png' });
};

const mapCardDocToLocal = (doc: CloudCardDoc): Flashcard => {
  // Convert file ID to preview URL for display
  let displayImageUrl = String(doc.imageUrl ?? '');
  
  // If imageUrl looks like a file ID (not a URL and not a data URL), convert it to preview URL
  if (displayImageUrl && !displayImageUrl.startsWith('http') && !displayImageUrl.startsWith('data:')) {
    const previewUrl = getImagePreviewUrl(displayImageUrl);
    console.debug('Converting file ID to preview URL:', {
      fileId: displayImageUrl,
      previewUrl: previewUrl.substring(0, 100),
    });
    displayImageUrl = previewUrl;
  }
  
  return {
    id: doc.$id,
    word: String(doc.word ?? doc.words ?? ''),
    imageUrl: displayImageUrl,
    categoryId: String(doc.categoryId ?? ''),
    createdAt: typeof doc.createdAt === 'number' ? doc.createdAt : Date.now(),
    updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : Date.now(),
    syncStatus: 'synced',
  };
};

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
        console.debug(`📋 listAllDocuments(${collectionId}):`, {
          fetched: response.documents.length,
          total: allDocs.length + response.documents.length,
          useOwnerFilter,
          userId,
        });
      } catch (error) {
        if (useOwnerFilter && isQueryCompatibilityError(error)) {
          // Some Appwrite setups reject this filter when the attribute/index is missing.
          console.warn(
            `📋 listAllDocuments(${collectionId}): Query with ownerId filter failed, retrying without filter`,
            error instanceof Error ? error.message : error
          );
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

    console.debug('⬇️ pullFromCloud: Starting pull for user', { userId: currentUser.$id });

    setSyncState((prev) => ({ ...prev, isSyncing: true }));

    try {
      console.debug('⬇️ pullFromCloud: Fetching remote cards and categories...');
      const [remoteCardDocs, remoteCategoryDocs] = await Promise.all([
        listAllDocuments<CloudCardDoc>(APPWRITE_CARDS_COLLECTION_ID, currentUser.$id),
        listAllDocuments<CloudCategoryDoc>(APPWRITE_CATEGORIES_COLLECTION_ID, currentUser.$id),
      ]);

      console.debug('⬇️ pullFromCloud: Fetched from cloud', {
        cardCount: remoteCardDocs.length,
        categoryCount: remoteCategoryDocs.length,
        cardIds: remoteCardDocs.map((c) => c.$id),
      });

      const remoteCategories = sortCategories(remoteCategoryDocs.map(mapCategoryDocToLocal));
      const remoteCards = remoteCardDocs.map(mapCardDocToLocal);

      console.debug('⬇️ pullFromCloud: Saving to local storage...');
      await Promise.all([
        saveAllCategories(remoteCategories),
        saveAllCards(remoteCards),
      ]);

      console.debug('⬇️ pullFromCloud: Saved to local storage', {
        cardCount: remoteCards.length,
        categoryCount: remoteCategories.length,
      });

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
      console.error('⬇️ pullFromCloud failed:', message, error);
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

      const ext = file.name.split('.').pop();
      // Log upload attempt for debugging
      console.debug(`Uploading image: ${file.name}`, {
        fileName: file.name,
        extension: ext,
        mimeType: file.type,
        sizeKB: Math.round(file.size / 1024),
        bucketId: APPWRITE_STORAGE_BUCKET_ID,
        fileIdForDatabase: cardId,
      });

      await appwriteStorage.createFile(APPWRITE_STORAGE_BUCKET_ID, cardId, file, permissions);
      
      console.debug(`✓ Image uploaded successfully: ${file.name}`);
      // Return just the file ID for the database, not the preview URL
      return cardId;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ Image upload failed', {
        error: errorMsg,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        fullError: error,
      });
      
      if (errorMsg.includes('extension') || errorMsg.includes('MIME') || errorMsg.includes('File')) {
        console.error('→ Issue: File extension rejected. Check Appwrite bucket allows: jpg, jpeg, png, svg, gif, webp');
      } else if (errorMsg.includes('permission') || errorMsg.includes('401') || errorMsg.includes('403')) {
        console.error('→ Issue: Permission denied. User may not have storage access.');
      } else if (errorMsg.includes('quota') || errorMsg.includes('limit')) {
        console.error('→ Issue: Storage quota or upload limit exceeded.');
      } else if (errorMsg.includes('size')) {
        console.error('→ Issue: File size exceeds limit.');
      }
      // Fall back to storing the data URL locally
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
                const createErrorMsg = createError instanceof Error ? createError.message : String(createError);
                console.error(`Create failed for ${collectionId}/${documentId}:`, {
                  error: createErrorMsg,
                  payload,
                  fullError: createError,
                });

                const createUnknownAttribute = getUnknownAttribute(createError);
                if (createUnknownAttribute && createUnknownAttribute in payload) {
                  const { [createUnknownAttribute]: _removed, ...nextPayload } = payload;
                  console.warn(`Removing unknown attribute "${createUnknownAttribute}" and retrying...`);
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
          order: category.order ?? 0,
          createdAt: category.createdAt ?? Date.now(),
          updatedAt: category.updatedAt ?? Date.now(),
        };

        await upsertDocumentWithSchemaFallback(
          APPWRITE_CATEGORIES_COLLECTION_ID,
          category.id,
          payload
        );
      }));

      await Promise.all(effectiveLocalCards.map(async (card) => {
        // Validate that card has required fields including imageUrl
        // imageUrl must be a file ID (UUID format) or a preview URL, NOT a data URL
        if (!card.word || !card.categoryId || !card.imageUrl) {
          console.warn('⚠️ Card validation failed - missing required fields', {
            cardId: card.id,
            word: card.word,
            categoryId: card.categoryId,
            hasImageUrl: !!card.imageUrl,
          });
          return; // Skip this card
        }

        // Check if imageUrl is a data URL (still local, not uploaded)
        if (card.imageUrl.startsWith('data:')) {
          console.warn('⚠️ Card has local data URL, not uploaded yet', {
            cardId: card.id,
            word: card.word,
          });
          return; // Skip this card - image hasn't been uploaded to cloud yet
        }

        const payload = {
          ownerId: currentUser.$id,
          word: card.word,
          imageUrl: card.imageUrl,
          categoryId: card.categoryId,
          createdAt: card.createdAt ?? Date.now(),
          updatedAt: card.updatedAt ?? Date.now(),
        };

        console.debug('📤 Syncing card to cloud', {
          cardId: card.id,
          word: payload.word,
          categoryId: payload.categoryId,
          imageUrl: payload.imageUrl?.substring(0, 50) + '...',
        });

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

  const fullSyncWithPullFirst = useCallback(async (): Promise<SyncResult> => {
    // On login to a new device, pull cloud data FIRST to get the user's data,
    // then push any local changes to ensure cloud is up to date
    console.debug('🔄 fullSyncWithPullFirst: Starting pull...');
    const pull = await pullFromCloud();
    if (!pull.success) {
      console.warn('🔄 fullSyncWithPullFirst: Pull failed, aborting sync', pull);
      return pull;
    }

    console.debug('🔄 fullSyncWithPullFirst: Pull succeeded, now syncing to cloud...');
    return syncToCloud();
  }, [pullFromCloud, syncToCloud]);

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      console.debug('🔐 Login: Creating session...');
      await account.createEmailPasswordSession(email, password);
      
      console.debug('🔐 Login: Fetching user...');
      const currentUser = await account.get();
      console.debug('🔐 Login: User fetched:', { userId: currentUser.$id, email: currentUser.email });
      
      setUser(currentUser);
      
      console.debug('🔐 Login: Starting fullSyncWithPullFirst...');
      const syncResult = await fullSyncWithPullFirst();
      console.debug('🔐 Login: Sync completed', syncResult);
      
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Login failed';
      console.error('🔐 Login failed:', errorMsg, error);
      return { success: false, error: errorMsg };
    }
  }, [fullSyncWithPullFirst]);

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
      // On signup, only push local (no cloud data to pull initially)
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

    try {
      const unsubscribe = client.subscribe(
        [
          `databases.${APPWRITE_DATABASE_ID}.collections.${APPWRITE_CARDS_COLLECTION_ID}.documents`,
          `databases.${APPWRITE_DATABASE_ID}.collections.${APPWRITE_CATEGORIES_COLLECTION_ID}.documents`,
        ],
        () => {
          if (realtimePullTimer.current !== null) {
            window.clearTimeout(realtimePullTimer.current);
          }

          // Faster debounce for realtime sync (200ms) ensures cross-device changes appear quickly
          realtimePullTimer.current = window.setTimeout(() => {
            realtimePullTimer.current = null;
            void pullFromCloud();
          }, 200);
        }
      );

      return () => {
        if (realtimePullTimer.current !== null) {
          window.clearTimeout(realtimePullTimer.current);
        }
        unsubscribe();
      };
    } catch (error) {
      console.error('Failed to establish realtime subscription:', error);
      // Realtime connection failed - app will continue with manual sync
      return undefined;
    }
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
