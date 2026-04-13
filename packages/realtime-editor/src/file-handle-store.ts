/**
 * file-handle-store.ts
 *
 * 基于 IndexedDB 的 FileSystemFileHandle 持久化存储。
 *
 * File System Access API 返回的 FileSystemFileHandle 可以被存储在 IndexedDB 中，
 * 从而在页面刷新后仍可恢复对同一文件的读写能力（需用户重新授权一次）。
 *
 * 使用 IndexedDB 而非 localStorage 的原因：
 * - FileSystemFileHandle 是结构化可克隆（Structured Cloneable）对象
 * - localStorage 只能存储字符串，无法序列化 FileSystemFileHandle
 * - IndexedDB 原生支持结构化克隆存储
 */

const DB_NAME = 'alphatab-realtime-editor';
const DB_VERSION = 1;
const STORE_NAME = 'file-handles';

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * 保存文件句柄到 IndexedDB
 * @param documentId - 文档 ID，作为 key
 * @param handle - 要持久化的 FileSystemFileHandle
 */
export async function saveFileHandle(
    documentId: string,
    handle: FileSystemFileHandle
): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(handle, documentId);
        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

/**
 * 从 IndexedDB 获取文件句柄
 * @param documentId - 文档 ID
 * @returns FileSystemFileHandle 或 null（不存在时）
 */
export async function getFileHandle(
    documentId: string
): Promise<FileSystemFileHandle | null> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(documentId);
        request.onsuccess = () => {
            database.close();
            resolve(request.result as FileSystemFileHandle | undefined ?? null);
        };
        request.onerror = () => {
            database.close();
            reject(request.error);
        };
    });
}

/**
 * 从 IndexedDB 删除文件句柄
 * @param documentId - 文档 ID
 */
export async function removeFileHandle(documentId: string): Promise<void> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.delete(documentId);
        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

/**
 * 验证文件句柄的读写权限。
 *
 * 页面刷新后，之前保存的 FileSystemFileHandle 可能需要用户重新授权。
 * 调用 `queryPermission` 检查当前权限状态：
 * - 如果已授权（'granted'），直接返回 true
 * - 否则调用 `requestPermission` 弹出授权对话框
 *
 * @param handle - 需要验证的文件句柄
 * @param mode - 权限模式，'read' 或 'readwrite'
 * @returns 是否获得了指定权限
 */
export async function verifyPermission(
    handle: FileSystemFileHandle,
    mode: FileSystemPermissionMode = 'readwrite'
): Promise<boolean> {
    const options = { mode };

    // 先检查是否已有权限
    if ((await handle.queryPermission(options)) === 'granted') {
        return true;
    }

    // 请求用户授权
    if ((await handle.requestPermission(options)) === 'granted') {
        return true;
    }

    return false;
}
