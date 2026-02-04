import {NextRequest, NextResponse} from "next/server";
import {ParamountClient} from "@/lib/paramount/client";
import {
    buildCookieHeader,
    guessBaseOrigin,
    needsParamountAuth,
    PPLUS_BASE_URL,
    PPLUS_HEADER
} from "@/lib/paramount/utils";
import {httpClient} from "@/lib/http/client";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;


function rewriteMPD(params: {
    text: string;
    upstreamUrl: URL;
    baseOrigin: string;
    key: string;
    token: string;
}) {
    const { text, upstreamUrl, baseOrigin, key, token } = params;

    const toProxy = (attrValue: string) => {
        try {
            const absoluteUrl = new URL(attrValue, upstreamUrl).toString();
            const u = new URL(`/api/stremio/${key}/proxy/seg`, baseOrigin);
            u.searchParams.set("t", token);

            if (absoluteUrl.includes('$')) {
                const lastSlashIndex = absoluteUrl.lastIndexOf('/');
                const baseUrl = absoluteUrl.substring(0, lastSlashIndex + 1);
                const fileNameTemplate = absoluteUrl.substring(lastSlashIndex + 1);

                u.searchParams.set("u", Buffer.from(baseUrl).toString('base64url'));
                return `${u.toString()}&f=${fileNameTemplate.replaceAll('?', '%3F').replaceAll('&', '%26')}`;
            }

            u.searchParams.set("u", Buffer.from(absoluteUrl).toString('base64url'));
            return u.toString();
        } catch (e) {
            return attrValue;
        }
    };

    return text.replace(
        /(?:href|media|initialization|BaseURL|template)=["']([^"']+)["']/g,
        (match, attrValue) => {
            const proxied = toProxy(attrValue);
            return match.replace(attrValue, proxied);
        }
    );
}

async function handle(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const session = client.getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(Buffer.from(u, 'base64url').toString('utf-8'));
    } catch {
        return new NextResponse("Bad upstream url", { status: 400 });
    }

    const headers: Record<string, string> = {
        "cache-control": "no-cache",
        "user-agent": await PPLUS_HEADER(),
        "accept": "application/dash+xml, video/vnd.mpeg.dash.mpd, */*",
    };

    if (needsParamountAuth(upstreamUrl.hostname)) {
        const upstreamToken = Buffer.from(t, 'base64url').toString('utf-8');
        headers["authorization"] = `Bearer ${upstreamToken}`;
        const cookie = buildCookieHeader(session.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const { status, data } = await httpClient.get(upstreamUrl.toString(), {
        headers: headers,
        responseType: "text"
    });

    const baseOrigin = guessBaseOrigin(req);
    const rewritten = rewriteMPD({
        text: data.toString(),
        upstreamUrl,
        baseOrigin,
        key,
        token: t
    });

    const outHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        "Content-Type": "application/dash+xml",
    });

    return new NextResponse(rewritten, { status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
