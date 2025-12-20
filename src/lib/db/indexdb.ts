// src/lib/db/indexdb.ts - ENHANCED WITH DUBBING SUPPORT
import type { DialogueSegment } from '@/types/voice';
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'fennai-voices';
const DB_VERSION = 5; // ← Bumped for dubbing support
const VOICE_STORE = 'voices';
const METADATA_STORE = 'metadata';
const DUBBING_STORE = 'dubbing_media'; // ← NEW STORE

// Existing voice record
export interface VoiceRecord {
    id: string;
    characterId: string;
    text: string;
    audioData: ArrayBuffer;
    audioType: string;
    audioBlob?: Blob;
    isMultiCharacter: boolean;
    characterIds?: string[];
    dialogues?: DialogueSegment[];
    duration: number;
    createdAt: number;
    lastAccessed?: number;
    size?: number;
    isInCloudStorage?: boolean;
}

// NEW: Dubbing media record
export interface DubbingMediaRecord {
    id: string; // Job ID
    mediaType: 'audio' | 'video';

    // Original Media
    audioData: ArrayBuffer;
    audioType: string;
    videoData?: ArrayBuffer;
    videoType?: string;

    // Result Media (the dubbed version)
    resultAudioData?: ArrayBuffer;
    resultAudioType?: string;
    resultVideoData?: ArrayBuffer;
    resultVideoType?: string;

    duration: number;
    fileSize: number;
    createdAt: number;
    lastAccessed?: number;
}

interface StorageMetadata {
    totalSize: number;
    voiceCount: number;
    lastCleanup: number;
}

interface StorageQuota {
    usage: number;
    quota: number;
    percentUsed: number;
    available: number;
}

interface CleanupResult {
    deletedCount: number;
    freedSpace: number;
    remainingVoices: number;
}

const STORAGE_WARNING_THRESHOLD = 0.8;
const STORAGE_CRITICAL_THRESHOLD = 0.9;
const AUTO_CLEANUP_AGE_DAYS = 30;
const MIN_VOICES_TO_KEEP = 10;

let dbPromise: Promise<IDBPDatabase> | null = null;

export async function initDB(): Promise<IDBPDatabase> {
    if (dbPromise) return dbPromise;

    try {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            async upgrade(db, oldVersion, newVersion, transaction) {
                // Create voice store
                if (!db.objectStoreNames.contains(VOICE_STORE)) {
                    const store = db.createObjectStore(VOICE_STORE, { keyPath: 'id' });
                    store.createIndex('characterId', 'characterId', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
                    store.createIndex('size', 'size', { unique: false });
                    store.createIndex('isInCloudStorage', 'isInCloudStorage', { unique: false });
                }

                const store = transaction.objectStore(VOICE_STORE);

                // Migration v3 → v4: Convert Blob → ArrayBuffer
                if (oldVersion < 4) {
                    const allKeys = await store.getAllKeys();
                    for (const key of allKeys) {
                        const old: any = await store.get(key);
                        if (old.audioBlob instanceof Blob && !old.audioData) {
                            try {
                                const arrayBuffer = await old.audioBlob.arrayBuffer();
                                const migrated: any = {
                                    ...old,
                                    audioData: arrayBuffer,
                                    audioType: old.audioBlob.type || 'audio/wav',
                                };
                                delete migrated.audioBlob;
                                await store.put(migrated);
                            } catch (err) {
                                console.error(`Failed to migrate ${old.id}:`, err);
                            }
                        }
                    }
                }

                // Ensure indexes exist
                ['lastAccessed', 'size', 'isInCloudStorage'].forEach(name => {
                    if (!store.indexNames.contains(name)) {
                        store.createIndex(name, name, { unique: false });
                    }
                });

                // Create metadata store
                if (!db.objectStoreNames.contains(METADATA_STORE)) {
                    db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
                }

                // NEW: Create dubbing media store
                if (!db.objectStoreNames.contains(DUBBING_STORE)) {
                    const dubbingStore = db.createObjectStore(DUBBING_STORE, { keyPath: 'id' });
                    dubbingStore.createIndex('createdAt', 'createdAt', { unique: false });
                    dubbingStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
                }
            },
            blocked() {
                console.warn('IndexedDB blocked – close other tabs');
                alert('IndexedDB is blocked. Please close other tabs of this site and refresh.');
            },
            blocking() {
                console.warn('Newer DB version available – refreshing...');
                window.location.reload();
            },
        });
    } catch (e) {
        console.error('Failed to open IndexedDB:', e);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) {
            alert('Could not initialize local storage. This often happens in Safari Private Browsing mode. Please try using a regular tab.');
        } else {
            alert('Local storage initialization failed. Some features may not work.');
        }
        throw e;
    }

    if (!dbPromise) {
        throw new Error('Database initialization failed');
    }
    return dbPromise;
}

// Helper: Reconstruct Blob
function reconstructBlob(record: any): Blob | null {
    if (record.audioData instanceof ArrayBuffer) {
        return new Blob([record.audioData], { type: record.audioType || 'audio/wav' });
    }
    return null;
}

// ==================== VOICE FUNCTIONS (EXISTING) ====================

export async function saveVoiceToIndexedDB(voiceInput: {
    id: string;
    characterId: string;
    text: string;
    audioBlob: Blob;
    isMultiCharacter: boolean;
    characterIds?: string[];
    dialogues?: DialogueSegment[];
    duration: number;
    createdAt: number;
    isInCloudStorage?: boolean;
}): Promise<void> {
    const db = await initDB();

    if (!(voiceInput.audioBlob instanceof Blob) || voiceInput.audioBlob.size === 0) {
        throw new Error('Invalid or empty audio blob');
    }

    const arrayBuffer = await voiceInput.audioBlob.arrayBuffer();
    const size = voiceInput.audioBlob.size;

    const check = await checkStorageAvailable(size);
    if (!check.available) {
        await autoCleanupOldVoices();
        const recheck = await checkStorageAvailable(size);
        if (!recheck.available) throw new Error(recheck.warning || 'Storage full');
    }

    const record = {
        id: voiceInput.id,
        characterId: voiceInput.characterId,
        text: voiceInput.text,
        audioData: arrayBuffer,
        audioType: voiceInput.audioBlob.type || 'audio/wav',
        isMultiCharacter: voiceInput.isMultiCharacter,
        characterIds: voiceInput.characterIds,
        dialogues: voiceInput.dialogues,
        duration: voiceInput.duration,
        createdAt: voiceInput.createdAt,
        lastAccessed: Date.now(),
        size,
        isInCloudStorage: voiceInput.isInCloudStorage ?? false,
    };

    await db.put(VOICE_STORE, record);
    await updateStorageMetadata();
}

export async function getVoiceFromIndexedDB(id: string): Promise<VoiceRecord | undefined> {
    const db = await initDB();
    const record = await db.get(VOICE_STORE, id);
    if (!record) return undefined;

    const audioBlob = reconstructBlob(record);
    if (!audioBlob) {
        console.error(`Voice ${id} has no audio data`);
        return undefined;
    }

    record.lastAccessed = Date.now();
    await db.put(VOICE_STORE, record);

    return {
        ...record,
        audioBlob,
    } as VoiceRecord;
}

export async function getVoicesByCharacter(
    characterId: string,
    options?: { sortBy?: 'createdAt' | 'lastAccessed'; limit?: number; includeCloudOnly?: boolean }
): Promise<VoiceRecord[]> {
    const db = await initDB();
    const index = db.transaction(VOICE_STORE).store.index('characterId');
    let records = await index.getAll(characterId);

    if (!options?.includeCloudOnly) {
        records = records.filter(r => !r.isInCloudStorage || r.audioData);
    }

    const voices: VoiceRecord[] = records
        .map(r => {
            const blob = reconstructBlob(r);
            return blob ? { ...r, audioBlob: blob } as VoiceRecord : null;
        })
        .filter(Boolean) as VoiceRecord[];

    const sortBy = options?.sortBy || 'createdAt';
    voices.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));
    if (options?.limit) voices.splice(options.limit);

    return voices;
}

export async function getAllVoices(options?: {
    sortBy?: 'createdAt' | 'lastAccessed' | 'size';
    limit?: number;
    includeCloudOnly?: boolean;
}): Promise<VoiceRecord[]> {
    const db = await initDB();
    let records = await db.getAll(VOICE_STORE);

    if (!options?.includeCloudOnly) {
        records = records.filter(r => !r.isInCloudStorage || r.audioData);
    }

    const voices: VoiceRecord[] = records
        .map(r => {
            const blob = reconstructBlob(r);
            return blob ? { ...r, audioBlob: blob } as VoiceRecord : null;
        })
        .filter(Boolean) as VoiceRecord[];

    if (options?.sortBy) {
        voices.sort((a, b) => (b[options.sortBy!] || 0) - (a[options.sortBy!] || 0));
    }
    if (options?.limit) voices.splice(options.limit);

    return voices;
}

export async function deleteVoiceFromIndexedDB(id: string): Promise<boolean> {
    const db = await initDB();
    await db.delete(VOICE_STORE, id);
    await updateStorageMetadata();
    return true;
}

export async function deleteAllVoicesForCharacter(characterId: string): Promise<number> {
    const voices = await getVoicesByCharacter(characterId, { includeCloudOnly: true });
    const tx = (await initDB()).transaction(VOICE_STORE, 'readwrite');
    for (const v of voices) await tx.store.delete(v.id);
    await tx.done;
    await updateStorageMetadata();
    return voices.length;
}

export async function clearAllVoices(): Promise<void> {
    const db = await initDB();
    await db.clear(VOICE_STORE);
    await updateStorageMetadata();
}

export async function autoCleanupOldVoices(): Promise<CleanupResult> {
    const db = await initDB();
    const all = await db.getAll(VOICE_STORE);
    const local = all.filter(v => v.audioData);

    if (local.length <= MIN_VOICES_TO_KEEP) {
        return { deletedCount: 0, freedSpace: 0, remainingVoices: local.length };
    }

    const threshold = Date.now() - AUTO_CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000;
    const oldOnes = local
        .filter(v => v.createdAt < threshold)
        .sort((a, b) => a.createdAt - b.createdAt);

    const toDelete = oldOnes.slice(0, local.length - MIN_VOICES_TO_KEEP);
    if (toDelete.length === 0) return { deletedCount: 0, freedSpace: 0, remainingVoices: local.length };

    const tx = db.transaction(VOICE_STORE, 'readwrite');
    let freed = 0;
    for (const v of toDelete) {
        await tx.store.delete(v.id);
        freed += v.size || 0;
    }
    await tx.done;
    await updateStorageMetadata();

    return { deletedCount: toDelete.length, freedSpace: freed, remainingVoices: local.length - toDelete.length };
}

async function updateStorageMetadata() {
    const db = await initDB();
    const all = await db.getAll(VOICE_STORE);
    const totalSize = all.reduce((s, v) => s + (v.size || 0), 0);
    await db.put(METADATA_STORE, { key: 'storage', totalSize, voiceCount: all.length, lastCleanup: Date.now() });
}

export async function deleteVoicesBatch(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const db = await initDB();
    const tx = db.transaction(VOICE_STORE, 'readwrite');
    let deletedCount = 0;

    for (const id of ids) {
        try {
            await tx.store.delete(id);
            deletedCount++;
        } catch (err) {
            console.warn(`Failed to delete voice ${id}:`, err);
        }
    }

    await tx.done;
    await updateStorageMetadata();

    return deletedCount;
}

// ==================== DUBBING MEDIA FUNCTIONS (NEW) ====================

export async function saveDubbingMedia(media: {
    id: string;
    mediaType: 'audio' | 'video';
    audioData: ArrayBuffer;
    audioType: string;
    videoData?: ArrayBuffer;
    videoType?: string;
    duration: number;
    fileSize: number;
    createdAt: number;
}): Promise<void> {
    const db = await initDB();

    // Storage check
    const check = await checkStorageAvailable(media.fileSize);
    if (!check.available) {
        await autoCleanupDubbingMedia();
        const recheck = await checkStorageAvailable(media.fileSize);
        if (!recheck.available) throw new Error(recheck.warning || 'Storage full');
    }

    const record: DubbingMediaRecord = {
        id: media.id,
        mediaType: media.mediaType,
        audioData: media.audioData,
        audioType: media.audioType,
        videoData: media.videoData,
        videoType: media.videoType,
        duration: media.duration,
        fileSize: media.fileSize,
        createdAt: media.createdAt,
        lastAccessed: Date.now(),
    };

    await db.put(DUBBING_STORE, record);
}

export async function saveDubbingResult(result: {
    id: string;
    resultAudioData?: ArrayBuffer;
    resultAudioType?: string;
    resultVideoData?: ArrayBuffer;
    resultVideoType?: string;
}): Promise<void> {
    const db = await initDB();
    const record = await db.get(DUBBING_STORE, result.id);

    if (!record) {
        console.warn(`[IndexDB] Cannot save result: Record ${result.id} not found`);
        return;
    }

    const updated: DubbingMediaRecord = {
        ...record,
        resultAudioData: result.resultAudioData || record.resultAudioData,
        resultAudioType: result.resultAudioType || record.resultAudioType,
        resultVideoData: result.resultVideoData || record.resultVideoData,
        resultVideoType: result.resultVideoType || record.resultVideoType,
        lastAccessed: Date.now(),
    };

    await db.put(DUBBING_STORE, updated);
}

export async function getDubbingMedia(id: string): Promise<DubbingMediaRecord | undefined> {
    const db = await initDB();
    const record = await db.get(DUBBING_STORE, id);

    if (record) {
        record.lastAccessed = Date.now();
        await db.put(DUBBING_STORE, record);
    }

    return record;
}

export async function deleteDubbingMedia(id: string): Promise<boolean> {
    const db = await initDB();
    await db.delete(DUBBING_STORE, id);
    return true;
}

export async function getAllDubbingMedia(): Promise<DubbingMediaRecord[]> {
    const db = await initDB();
    return await db.getAll(DUBBING_STORE);
}

export async function autoCleanupDubbingMedia(): Promise<CleanupResult> {
    const db = await initDB();
    const all = await db.getAll(DUBBING_STORE);

    // Delete dubbing media older than 7 days
    const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const toDelete = all.filter(m => m.createdAt < threshold);

    if (toDelete.length === 0) {
        return { deletedCount: 0, freedSpace: 0, remainingVoices: all.length };
    }

    const tx = db.transaction(DUBBING_STORE, 'readwrite');
    let freed = 0;

    for (const m of toDelete) {
        await tx.store.delete(m.id);
        freed += m.fileSize || 0;
    }

    await tx.done;

    return {
        deletedCount: toDelete.length,
        freedSpace: freed,
        remainingVoices: all.length - toDelete.length
    };
}

// ==================== STORAGE UTILITIES ====================

export async function getStorageQuota(): Promise<StorageQuota> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        try {
            const est = await navigator.storage.estimate();
            return {
                usage: est.usage || 0,
                quota: est.quota || 0,
                percentUsed: est.quota ? (est.usage || 0) / est.quota * 100 : 0,
                available: (est.quota || 0) - (est.usage || 0),
            };
        } catch (e) { /* ignore */ }
    }
    return { usage: 0, quota: 0, percentUsed: 0, available: 0 };
}

export async function checkStorageAvailable(requiredBytes = 0) {
    const quota = await getStorageQuota();
    const full = quota.percentUsed >= STORAGE_CRITICAL_THRESHOLD * 100;
    const notEnough = requiredBytes > quota.available;

    if (full || notEnough) {
        return { available: false, quota, warning: full ? 'Storage critical' : 'Not enough space' };
    }
    return { available: true, quota };
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export async function getStorageStats() {
    const db = await initDB();
    const voices = await db.getAll(VOICE_STORE);
    const dubbingMedia = await db.getAll(DUBBING_STORE);
    const quota = await getStorageQuota();

    const local = voices.filter(v => v.audioData);
    const voicesSize = local.reduce((s, v) => s + (v.size || 0), 0);
    const dubbingSize = dubbingMedia.reduce((s, m) => s + (m.fileSize || 0), 0);
    const totalSize = voicesSize + dubbingSize;

    const timestamps = voices.map(v => v.createdAt).filter(Boolean);

    return {
        voiceCount: local.length,
        dubbingMediaCount: dubbingMedia.length,
        voicesSize,
        dubbingSize,
        totalSize,
        averageSize: local.length ? voicesSize / local.length : 0,
        oldestVoice: timestamps.length ? new Date(Math.min(...timestamps)) : null,
        newestVoice: timestamps.length ? new Date(Math.max(...timestamps)) : null,
        quota,
        cloudStorageCount: voices.filter(v => v.isInCloudStorage).length,
    };
}

export async function getVoicesForCleanup(): Promise<{
    old: VoiceRecord[];
    unused: VoiceRecord[];
    large: VoiceRecord[];
}> {
    const allVoices = await getAllVoices();
    const now = Date.now();
    const ageThreshold = now - (AUTO_CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000);
    const unusedThreshold = now - (7 * 24 * 60 * 60 * 1000);

    const sizes = allVoices.map(v => v.size || 0).sort((a, b) => a - b);
    const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] || 0 : 0;
    const largeSizeThreshold = medianSize * 2;

    return {
        old: allVoices.filter(v => v.createdAt < ageThreshold),
        unused: allVoices.filter(v => (v.lastAccessed || v.createdAt) < unusedThreshold),
        large: allVoices.filter(v => (v.size || 0) > largeSizeThreshold),
    };
}

export async function exportVoicesMetadata(): Promise<string> {
    const voices = await getAllVoices({ includeCloudOnly: true });
    const metadata = voices.map(v => ({
        id: v.id,
        characterId: v.characterId,
        text: v.text,
        isMultiCharacter: v.isMultiCharacter,
        characterIds: v.characterIds,
        duration: v.duration,
        createdAt: v.createdAt,
        lastAccessed: v.lastAccessed,
        size: v.size,
        isInCloudStorage: v.isInCloudStorage,
    }));
    return JSON.stringify(metadata, null, 2);
}