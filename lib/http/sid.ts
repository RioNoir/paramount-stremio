import { createHash } from 'crypto';

const globalCache = global as any;
if (!globalCache.urlCache) {
    globalCache.urlCache = new Map<string, {
        key: string,
        u: string|null,
        t: string|null,
        l?: string|null,
        f?: string|null,
    }>();
}
const urlCache = globalCache.urlCache;

export function shorten(key: string, u: string, t: string, l?: string, f?: string) {
    const seed = `${key}-${u}-${t}-${l}-${f}`;
    const sid = createHash('md5').update(seed).digest('hex').substring(0, 20).toString().toUpperCase();
    if (!urlCache.has(sid)) {
        urlCache.set(sid, { key, u, t, l, f });
        setTimeout(() => urlCache.delete(sid), 24 * 60 * 60 * 1000);
    }
    return sid;
}

export function extend(sid: string) : {
    key: string;
    u: string | null;
    t: string | null;
    l?: string | null;
    f?: string | null
} | null {
    return urlCache.get(sid) ?? null;
}