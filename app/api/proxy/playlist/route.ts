import { withCors, optionsCors } from "@/lib/stremio/cors";
import { getSessionFromKey } from "@/lib/auth/session";

export function OPTIONS() { return optionsCors(); }

function absolutize(base: string, ref: string) {
    try { return new URL(ref, base).toString(); } catch { return ref; }
}

function cookieHeader(cookies: string[]) {
    return cookies.map(c => c.split(";")[0]).join("; ");
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || "";
    const src = url.searchParams.get("u") || "";
    if (!key || !src) return withCors(Response.json({ error: "Missing params" }, { status: 400 }));

    const session = await getSessionFromKey(key);
    if (!session) return withCors(Response.json({ error: "Invalid/expired key" }, { status: 401 }));

    const upstream = await fetch(src, {
        headers: { Cookie: cookieHeader(session.cookies) },
        cache: "no-store",
    });

    if (!upstream.ok) return withCors(Response.json({ error: "Upstream playlist error" }, { status: 502 }));

    const text = await upstream.text();
    const rewritten = text.split("\n").map((line) => {
        const l = line.trim();
        if (!l || l.startsWith("#")) return line;

        const abs = absolutize(src, l);
        return `${url.origin}/api/proxy/segment?key=${encodeURIComponent(key)}&u=${encodeURIComponent(abs)}`;
    }).join("\n");

    return withCors(new Response(rewritten, {
        status: 200,
        headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
        },
    }));
}
