import { withCors, optionsCors } from "@/lib/stremio/cors";
import { getSessionFromKey } from "@/lib/auth/session";

export function OPTIONS() { return optionsCors(); }

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

    if (!upstream.ok) return withCors(Response.json({ error: "Upstream segment error" }, { status: 502 }));

    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-store");
    return withCors(new Response(upstream.body, { status: 200, headers }));
}
