import { withCors, optionsCors } from "@/lib/stremio/cors";
import { readSessionFromKey } from "@/lib/auth/session";
import { ParamountContentApi } from "@/lib/paramount/content";

export function OPTIONS() { return optionsCors(); }

/**
 * Uso:
 *   /api/debug/paramount?key=<JWE>&endpoint=trending_movies
 *   /api/debug/paramount?key=<JWE>&endpoint=featured
 *   /api/debug/paramount?key=<JWE>&endpoint=search&term=halo
 *   /api/debug/paramount?key=<JWE>&endpoint=show&showId=12345
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") || "";
    const endpoint = url.searchParams.get("endpoint") || "";

    const session = await readSessionFromKey(key);
    if (!session) return withCors(Response.json({ error: "Invalid/expired key" }, { status: 401 }));

    const api = new ParamountContentApi();

    try {
        if (endpoint === "trending_movies") {
            const data = await api.trendingMovies(session.cookies);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "trending_series") {
            const data = await api.trendingShows(session.cookies);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "featured") {
            const data = await api.featured(session.cookies);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "search") {
            const term = url.searchParams.get("term") || "";
            const data = await api.search(session.cookies, term);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "show") {
            const showId = url.searchParams.get("showId") || "";
            const data = await api.show(session.cookies, showId);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "groups") {
            const data = await api.groups(session.cookies);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "group") {
            const groupId = url.searchParams.get("groupId") || "";
            const data = await api.group(session.cookies, groupId);
            return withCors(Response.json({ ok: true, data }));
        }

        if (endpoint === "carousel") {
            const carouselId = url.searchParams.get("carouselId") || "";
            if (!carouselId) {
                return withCors(Response.json({ ok: false, error: "Missing carouselId" }, { status: 400 }));
            }

            const start = Number(url.searchParams.get("start") ?? "0");
            const rows = Number(url.searchParams.get("rows") ?? "200");

            // Se vuoi provare a passare automaticamente userId/profileId/currentState/sourceType dalla sessione
            // (utile per i carousel personalized), abilita useSessionParams=1
            //const useSessionParams = url.searchParams.get("useSessionParams") === "1";

            const params: Record<string, any> = {
                start: Number.isFinite(start) ? start : 0,
                rows: Number.isFinite(rows) ? rows : 200,
            };

            if (session.userId != null) params.userId = session.userId;
            if (session.profileId != null) params.profileId = session.profileId;
            if (session.currentState) params.currentState = session.currentState;
            if (session.sourceType) params.sourceType = session.sourceType;

            const data = await api.carouselItems(session.cookies, carouselId, params);

            // Per aiutarti a capire rapidamente lo shape, ritorniamo anche le top keys
            const topKeys = data && typeof data === "object" ? Object.keys(data) : [];

            return withCors(
                Response.json({
                    ok: true,
                    carouselId,
                    paramsUsed: params,
                    topKeys,
                    data,
                })
            );
        }

        if(endpoint === "live"){
            const data = await api.sportsLiveUpcoming(session.cookies);
            return withCors(Response.json({ ok: true, data }));
        }

        return withCors(
            Response.json(
                { error: "Unknown endpoint. Use: trending_movies, trending_series, featured, search, show" },
                { status: 400 }
            )
        );
    } catch (e: any) {
        return withCors(Response.json({ ok: false, error: e?.message ?? "Error" }, { status: 500 }));
    }
}
