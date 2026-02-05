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
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {extend, shorten} from "@/lib/http/sid";

export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true
});

const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressBooleanAttributes: false
});

async function rewriteMPD(params: {
    text: string;
    upstreamUrl: URL;
    upstreamToken: string;
    licenseUrl?: URL|null;
    baseOrigin: string;
    key: string;
}) {
    const { text, upstreamUrl, upstreamToken, licenseUrl, baseOrigin, key } = params;

    const toProxy = (attrValue: string) => {
        try {
            const absoluteUrl = new URL(attrValue, upstreamUrl).toString();

            if (absoluteUrl.includes('$')) {
                const lastSlashIndex = absoluteUrl.lastIndexOf('/');
                const baseUrl = absoluteUrl.substring(0, lastSlashIndex + 1);
                const fileNameTemplate = absoluteUrl.substring(lastSlashIndex + 1);
                const sid = shorten(key, baseUrl, upstreamToken, licenseUrl?.toString());
                const u = new URL(`/api/proxy/${sid}/file/${fileNameTemplate}`, baseOrigin);
                return u.toString();
            }

            const sid = shorten(key, absoluteUrl.toString(), upstreamToken, licenseUrl?.toString());
            const u = new URL(`/api/proxy/${sid}/seg`, baseOrigin);
            return u.toString();
        } catch (e) {
            return attrValue;
        }
    };

    const jsonObj = parser.parse(text);
    const mpd = jsonObj.MPD;

    mpd["@_xmlns:dash"] = "urn:mpeg:dash:schema:mpd:2011";
    mpd["@_xmlns:cenc"] = "urn:mpeg:cenc:2013";
    delete mpd["@_xsi:schemaLocation"];

    const periods = Array.isArray(mpd.Period) ? mpd.Period : [mpd.Period];
    for (const period of periods) {
        const adaptationSets = Array.isArray(period.AdaptationSet) ? period.AdaptationSet : [period.AdaptationSet];

        for (const adSet of adaptationSets) {
            if (adSet["@_segmentAlignment"] !== undefined) adSet["@_segmentAlignment"] = "true";
            if (adSet["@_subsegmentAlignment"] !== undefined) adSet["@_subsegmentAlignment"] = "true";
            if (adSet["@_bitstreamSwitching"] !== undefined) adSet["@_bitstreamSwitching"] = "true";

            let originalPSSH = "";
            const cpTags = adSet.ContentProtection
                ? (Array.isArray(adSet.ContentProtection) ? adSet.ContentProtection : [adSet.ContentProtection])
                : [];

            for (const cp of cpTags) {
                if (cp["@_schemeIdUri"] === "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed") {
                    originalPSSH = cp["cenc:pssh"]?.["#text"] || cp["cenc:pssh"] || originalPSSH;
                }
            }

            const sid = shorten(key, upstreamUrl.toString(), upstreamToken, licenseUrl?.toString());
            const licenseUrlProxy = `${baseOrigin}/api/proxy/${sid}/license`;

            if (originalPSSH && originalPSSH.trim().length > 0) {
                adSet.ContentProtection = [
                    {
                        "@_schemeIdUri": "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",
                        "@_value": "Widevine",
                        "cenc:pssh": originalPSSH.replace(/\s/g, ''),
                        "dash:Laurl": licenseUrlProxy,
                        "Laurl": licenseUrlProxy
                    },
                    {
                        "@_schemeIdUri": "urn:mpeg:dash:mp4protection:2011",
                        "@_value": "cenc"
                    }
                ];
            } else {
                delete adSet.ContentProtection;
            }

            if (adSet.SegmentTemplate) {
                const st = adSet.SegmentTemplate;
                if (st["@_media"]) st["@_media"] = toProxy(st["@_media"]);
                if (st["@_initialization"]) st["@_initialization"] = toProxy(st["@_initialization"]);
            }
        }
    }

    const finalXml = builder.build(jsonObj);
    return finalXml.replace(/\u00A0/g, ' ').trim();
}

async function handle(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
    const { sid } = await ctx.params;

    const session = sid ? extend(sid) : null;
    const key = session?.key ?? null;
    const u = session?.u ?? null;
    const t = session?.t ?? null;
    const f = session?.f ?? null;
    const l = session?.l ?? "";
    if (!session || !key) {
        return new Response("Invalid Session", { status: 403 });
    }
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    const client = new ParamountClient();
    await client.setSessionKey(key);

    const pSession = client.getSession();
    if (!pSession) return new NextResponse("Unauthorized", { status: 401 });

    let baseUrl = u;
    baseUrl = f ? `${baseUrl}${f}` : baseUrl;

    const upstreamUrl = new URL(baseUrl);
    const upstreamToken = t;
    const licenseUrl = new URL(l?.toString());

    const headers: Record<string, string> = {
        "cache-control": "no-cache",
        "user-agent": await PPLUS_HEADER(),
        "accept": "application/dash+xml, video/vnd.mpeg.dash.mpd, */*",
    };

    if (needsParamountAuth(upstreamUrl.hostname)) {
        headers["authorization"] = `Bearer ${upstreamToken}`;
        const cookie = buildCookieHeader(pSession.cookies);
        if (cookie) headers["cookie"] = cookie;
        headers["origin"] = PPLUS_BASE_URL;
        headers["referer"] = PPLUS_BASE_URL;
    }

    const { status, data } = await httpClient.get(upstreamUrl.toString(), {
        headers: headers,
        responseType: "text"
    });

    const baseOrigin = guessBaseOrigin(req);
    const rewritten = await rewriteMPD({
        text: data.toString(),
        upstreamUrl,
        upstreamToken,
        licenseUrl,
        baseOrigin,
        key,
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
