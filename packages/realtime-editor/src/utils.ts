/**
 * 格式化毫秒为 MM:SS 格式
 */
export function formatTime(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 持久化值到 localStorage
 */
export function persistValue(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // ignore storage failures in private mode
    }
}

/**
 * 从 localStorage 读取值
 */
export function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * 安全文件名：移除非法字符
 */
export function safeFileName(value: string): string {
    return value.replace(/[^a-z0-9\-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'untitled';
}

/**
 * 提取错误消息
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * HTML 转义
 */
export function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * 创建并触发文件下载
 */
export function downloadBlob(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

/**
 * XHR 加载资源
 */
export function load<T>(url: URL, type: XMLHttpRequest['responseType']): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.onload = () => {
            resolve(request.response);
        };
        request.onerror = error => {
            reject(error);
        };
        request.open('GET', url);
        request.responseType = type;
        request.send();
    });
}
