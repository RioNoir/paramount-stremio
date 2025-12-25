import { NextRequest, NextResponse } from "next/server";
import { readSessionFromKey } from "@/lib/auth/session";

export const runtime = "nodejs";

function isSafeUrl(raw: string) {
    try {
        const u = new URL(raw);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * GET /api/stremio/[key]/proxy/img?u=https%3A%2F%2F...
 * - richiede sessione valida (key) così nessuno usa il tuo proxy gratis
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    // ✅ protezione base: proxy solo con key valida
    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return new NextResponse("Invalid session", { status: 401 });

    const u = req.nextUrl.searchParams.get("u") || "";
    if (!u || !isSafeUrl(u)) return new NextResponse("Bad url", { status: 400 });

    // opzionale: allowlist domini (consigliato)
    // const host = new URL(u).hostname;
    // if (!host.endsWith("pplusstatic.com") && !host.endsWith("paramountplus.com")) {
    //   return new NextResponse("Host not allowed", { status: 403 });
    // }

    const upstream = await fetch(u, {
        // immagini: di solito basta questo
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        cache: "no-store",
    });

    if (!upstream.ok) {
        return new NextResponse(`Upstream ${upstream.status}`, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const buf = await upstream.arrayBuffer();

    // Cache aggressiva per immagini (importantissimo su Vercel)
    return new NextResponse(buf, {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            // 7 giorni + stale-while-revalidate (ok per immagini)
            "Cache-Control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
        },
    });
}
