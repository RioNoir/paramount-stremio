import { NextRequest, NextResponse } from "next/server";
import {ParamountClient} from "@/lib/paramount/client";
import {needsParamountAuth, buildCookieHeader, forwardHeaders, copyRespHeaders, PPLUS_BASE_URL, PPLUS_HEADER} from "@/lib/paramount/utils";
import {httpClient} from "@/lib/http/client";
import {extend} from "@/lib/http/sid";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function handle(req: NextRequest, ctx: { params: Promise<{ sid: string, filename: string[] }> }) {
    const { sid, filename } = await ctx.params;

    const fileName = filename.join('/');
    if (!fileName) return new NextResponse("Invalid filename", { status: 400 });
    const { search } = new URL(req.url);

    const session = sid ? extend(sid) : null;
    const key = session?.key ?? null;
    const u = session?.u ?? null;
    const t = session?.t ?? null;
    if (!session || !key) {
        return new Response("Invalid Session", { status: 403 });
    }
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const pSession = client.getSession();
    if (!pSession) return new NextResponse("Unauthorized", { status: 401 });

    const finalUrl = `${u}${fileName}${search}`;
    const upstreamUrl = new URL(finalUrl);
    const upstreamToken = t;

    const headers: Record<string, string> = {
        ...forwardHeaders(req),
    };
    headers["user-agent"] = await PPLUS_HEADER();
    if (req.headers.has("range")) {
        headers["range"] = req.headers.get("range")!;
    }

    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${upstreamToken}`;

        const cookie = buildCookieHeader(pSession.cookies);
        if (cookie) headers["cookie"] = cookie;

        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const method = req.method === "HEAD" ? "HEAD" : "GET";
    const {status: status, data: stream, headers: resHeaders} = await httpClient.get(upstreamUrl.toString(), {
        headers: headers,
        method: method,
        responseType: 'stream',
        validateStatus: (s) => s < 500
    });

    const webStream = new ReadableStream({
        start(controller) {
            stream.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
            });
            stream.on("end", () => {
                controller.close();
            });
            stream.on("error", (err: Error) => {
                controller.error(err);
            });
        },
        cancel() {
            stream.destroy();
        }
    });

    const outHeaders = copyRespHeaders(resHeaders);

    const ext = fileName.split('.').pop()?.split('?')[0].toLowerCase();
    const mimeTypes: Record<string, string> = {
        'ts': 'video/mp2t',
        'mp4': 'video/mp4',
        'm4s': 'video/mp4',
        'm4a': 'audio/mp4',
        'm4v': 'video/mp4'
    };

    if (ext && mimeTypes[ext]) {
        outHeaders.set("Content-Type", mimeTypes[ext]);
    }

    outHeaders.set("Allow", "GET, HEAD, OPTIONS");
    outHeaders.set("Access-Control-Allow-Origin", "*");
    outHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    outHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    outHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Date, Server, Transfer-Encoding");
    if (ext === 'mp4' || ext === 'm4s' || ext === 'm4a') {
        outHeaders.set("Cache-Control", "public, max-age=3600, immutable");
    } else {
        outHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
    }

    if (method === "HEAD") {
        return new NextResponse(null, { status: status, headers: outHeaders });
    }

    return new NextResponse(webStream, { status: status, headers: outHeaders });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}
