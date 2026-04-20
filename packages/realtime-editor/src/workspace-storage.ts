import { STORAGE_KEYS } from './constants';
import { getDocumentsInOrder, state } from './state';
import type { WorkspaceDocumentSnapshot, WorkspaceSnapshot } from './types';
import { persistValue, readStorage } from './utils';

function removeStorageKey(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // ignore storage failures in private mode
    }
}

function toSnapshot(): WorkspaceSnapshot {
    const documents: WorkspaceDocumentSnapshot[] = getDocumentsInOrder().map(document => ({
        id: document.id,
        displayName: document.displayName,
        sourceKind: document.sourceKind,
        content: document.model.getValue(),
        savedContent: document.savedContent,
        isDirty: document.isDirty,
        activeTrackIndexes: [...document.activeTrackIndexes],
        lastSuccessfulCode: document.lastSuccessfulCode,
        scoreTitle: document.scoreTitle,
        scoreSubtitle: document.scoreSubtitle,
        hasFileHandle: document.hasFileHandle ?? false,
        lastModifiedAt: document.lastModifiedAt,
        lastSavedAt: document.lastSavedAt,
        diskLastModifiedAt: document.diskLastModifiedAt
    }));

    return {
        version: 1,
        activeDocumentId: state.activeDocumentId,
        documents
    };
}

export function persistWorkspace(): void {
    if (state.documentOrder.length === 0) {
        removeStorageKey(STORAGE_KEYS.workspace);
        return;
    }

    persistValue(STORAGE_KEYS.workspace, JSON.stringify(toSnapshot()));
    removeStorageKey(STORAGE_KEYS.document);
    removeStorageKey(STORAGE_KEYS.example);
}

export function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
    const raw = readStorage(STORAGE_KEYS.workspace);
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as WorkspaceSnapshot;
        if (parsed.version !== 1 || !Array.isArray(parsed.documents)) {
            return null;
        }

        return {
            version: 1,
            activeDocumentId: typeof parsed.activeDocumentId === 'string' ? parsed.activeDocumentId : null,
            documents: parsed.documents.filter(document => {
                return typeof document?.id === 'string' && typeof document?.displayName === 'string';
            })
        };
    } catch {
        return null;
    }
}
