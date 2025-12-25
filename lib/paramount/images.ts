import { normImg } from "@/lib/paramount/mapping";
import { proxyImgUrl } from "@/lib/stremio/proxyUrls";

export function normImgProxied(baseOrigin: string, key: string, raw?: string) {
    const upstream = normImg(raw);
    return proxyImgUrl(baseOrigin, key, upstream);
}
