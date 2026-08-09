import { NextRequest, NextResponse } from "next/server";
import { PPLUS_IMG_BASE, PPLUS_HEADER } from "@/lib/paramount/utils";
import { httpClient } from "@/lib/http/client";

export const runtime = "nodejs";

const IMG_CACHE_TTL = 24 * 60 * 60 * 1000;
const IMG_CACHE_MAX_ENTRIES = 500;

type CachedImage = { body: Buffer; contentType: string; expiresAt: number };
const imgCache = new Map<string, CachedImage>();

export async function GET(req: NextRequest) {
    const src = req.nextUrl.searchParams.get("u");
    if (!src) return new NextResponse("Missing u", { status: 400 });

    if (!src.startsWith(PPLUS_IMG_BASE)) {
        return new NextResponse("Forbidden", { status: 403 });
    }

    const cached = imgCache.get(src);
    if (cached && Date.now() < cached.expiresAt) {
        return new NextResponse(new Uint8Array(cached.body), {
            headers: {
                "Content-Type": cached.contentType,
                "Cache-Control": "public, max-age=86400, immutable",
            },
        });
    }

    const userAgent = await PPLUS_HEADER();
    let status: number, data: any, headers: Headers;
    try {
        ({ status, data, headers } = await httpClient.getDirect(src, {
            headers: { "User-Agent": userAgent, "Accept": "image/*" },
            responseType: "arraybuffer",
        }));
    } catch (err: any) {
        console.error(`[img] GET ${src} failed:`, err.message);
        return NextResponse.redirect(src, 302);
    }

    if (status >= 400) {
        console.error(`[img] GET ${src} returned ${status}, falling back to redirect`);
        return NextResponse.redirect(src, 302);
    }

    const body = Buffer.from(data);
    const contentType = headers.get("content-type") ?? "image/jpeg";

    if (imgCache.size >= IMG_CACHE_MAX_ENTRIES) {
        const oldestKey = imgCache.keys().next().value;
        if (oldestKey) imgCache.delete(oldestKey);
    }
    imgCache.set(src, { body, contentType, expiresAt: Date.now() + IMG_CACHE_TTL });

    return new NextResponse(new Uint8Array(body), {
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, immutable",
        },
    });
}
