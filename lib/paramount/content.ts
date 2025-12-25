// lib/paramount/content.ts

const BASE_URL = "https://www.paramountplus.com";

// AT token (US) — stesso approccio usato in EPlusTV, ma qui lo teniamo costante
// Se smette di funzionare, va aggiornato.
const AT_TOKEN_US = "ABB+XYTJa4Y14QBS5+7jCYvFe04w88I5dxzStu4zlQ4rqTTW/iMZ33tuiqPzzdgMJjQ=";

const LOCALE_US = "en-us";

function cookieHeader(cookies: string[]) {
    return cookies.map((c) => c.split(";")[0]).join("; ");
}

function toNum(x: any): number | null {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

// Estrae un possibile url immagine da diversi shape
function pickImage(obj: any): string | undefined {
    if (!obj) return undefined;
    return (
        obj?.url ||
        obj?.fileUrl ||
        obj?.src ||
        obj?.["0"]?.url ||
        obj?.poster?.url ||
        obj?.showPoster?.url ||
        obj?.thumbnail?.url ||
        undefined
    );
}

export class ParamountContentApi {
    private async getJson<T>(
        apiPath: string,
        cookies: string[],
        params?: Record<string, any>
    ): Promise<T> {
        const url = new URL(`${BASE_URL}/apps-api${apiPath}`);
        url.searchParams.set("at", AT_TOKEN_US);
        url.searchParams.set("locale", LOCALE_US);

        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v === undefined || v === null) continue;
                url.searchParams.set(k, String(v));
            }
        }

        const debug = process.env.DEBUG_PARAMOUNT === "1";
        if (debug) {
            console.log("[PPLUS] GET", apiPath);
            console.log("[PPLUS] URL", url.toString());
            console.log("[PPLUS] Cookie count", cookies.length);
            console.log("[PPLUS] Cookie header bytes", cookieHeader(cookies).length);
        }

        const res = await fetch(url.toString(), {
            headers: {
                "User-Agent": "Paramount+/15.5.0 (com.cbs.ott; androidphone) okhttp/5.1.0",
                Cookie: cookieHeader(cookies),
            },
            cache: "no-store",
        });

        const text = await res.text().catch(() => "");
        if (debug) {
            console.log("[PPLUS] Status", res.status);
            console.log("[PPLUS] Body first 300", text.slice(0, 300));
        }

        if (!res.ok) {
            throw new Error(`Paramount API ${res.status} ${apiPath} ${text.slice(0, 200)}`);
        }

        return JSON.parse(text) as T;
    }

    // ---------- CATALOG / SEARCH ----------

    sportsLiveUpcoming(cookies: string[], params: Record<string, any> = {}) {
        return this.getJson<any>(
            "/v3.0/androidtv/hub/multi-channel-collection/live-and-upcoming.json",
            cookies,
            {
                // parametri “safe default”
                at: AT_TOKEN_US,
                locale: "en-us",
                platformType: "androidtv",
                rows: 300,
                start: 0,
                ...params,
            }
        );
    }

    liveChannelListings(cookies: string[], slug: string, params: Record<string, any> = {}) {
        return this.getJson<any>(
            `/v3.0/androidphone/live/channels/${slug}/listings.json`,
            cookies,
            {
                locale: "en-us",
                rows: 125,
                start: 0,
                showListing: true,
                ...params,
            }
        );
    }

    irdetoSessionToken(cookies: string[], contentId: string) {
        return this.getJson<any>(
            "/v3.1/androidphone/irdeto-control/session-token.json",
            cookies,
            { at: AT_TOKEN_US, locale: "en-us", contentId }
        );
    }

    featured(cookies: string[]) {
        // carrelli home (contiene show e movie a seconda della riga)
        return this.getJson<any>("/v3.0/androidphone/home/configurator.json", cookies, {
            minProximity: 1,
            minCarouselItems: 1,
            maxCarouselItems: 25,
            rows: 50,
        });
    }

    carouselItems(cookies: string[], carouselId: string, params: Record<string, any>) {
        return this.getJson<any>(
            `/v3.0/androidphone/home/configurator/carousels/${carouselId}/items.json`,
            cookies,
            {
                _clientRegion: "US",
                platformType: "desktop",
                locale: "en-us",
                start: 0,
                rows: 200,
                ...params,
            }
        );
    }

    trendingMovies(cookies: string[]) {
        return this.getJson<any>("/v3.0/androidphone/movies/trending.json", cookies);
    }

    trendingShows(cookies: string[]) {
        // se non esiste in alcune build, useremo featured/search; intanto lo proviamo
        return this.getJson<any>("/v3.0/androidphone/shows/trending.json", cookies);
    }

    search(cookies: string[], term: string) {
        return this.getJson<any>("/v3.0/androidphone/contentsearch/search.json", cookies, {
            term,
            rows: 50,
            start: 0,
            includeTrailerInfo: false,
            includeContentInfo: true,
            platformType: "androidphone",
            packageCode: "CBS_ALL_ACCESS_AD_FREE_PACKAGE",
        });
    }

    movie(cookies: string[], movieId: string) {
        return this.getJson<any>(`/v3.0/androidphone/movies/${movieId}.json`, cookies);
    }

    // ---------- SHOW DETAILS + EPISODES ----------

    show(cookies: string[], showId: string) {
        return this.getJson<any>(`/v3.0/androidphone/shows/${showId}.json`, cookies);
    }

    groups(cookies: string[]) {
        return this.getJson<any>("/v2.0/androidphone/shows/groups.json", cookies);
    }

    group(cookies: string[], groupId: string) {
        return this.getJson<any>(`/v2.0/androidphone/shows/group/${groupId}.json`, cookies, {
            rows: 50,
            begin: 0,
        });
    }

    movieGroups(cookies: string[]) {
        return this.getJson<any>("/v2.0/androidphone/movies/groups.json", cookies);
    }

    movieGroup(cookies: string[], groupId: string) {
        return this.getJson<any>(`/v2.0/androidphone/movies/group/${groupId}.json`, cookies, {
            rows: 50,
            begin: 0,
        });
    }

    /**
     * Recupera la “sezione video” migliore per episodi.
     * L’addon Kodi cerca "Full Episodes", altrimenti prende l’ultima sezione.
     */
    async getVideoSection(cookies: string[], showId: string): Promise<any | null> {
        const data = await this.getJson<any>(
            `/v2.0/androidphone/shows/${showId}/videos/configuration.json`,
            cookies,
            {
                rows: 1,
                begin: 0,
            }
        );

        if (!data?.videoSectionMetadata || !data?.numFound) return null;

        const sections: any[] = data.videoSectionMetadata;
        const full = sections.find((s) => s?.section_type === "Full Episodes");
        return full ?? sections[sections.length - 1] ?? null;
    }

    /**
     * Lista stagioni disponibili (di solito 1..N).
     */
    async seasons(cookies: string[], showId: string): Promise<number[]> {
        const data = await this.getJson<any>(
            `/v3.0/androidphone/shows/${showId}/video_available_season.json`,
            cookies
        );

        const list = data?.video_available_season?.itemList ?? [];
        const seasons = list
            .map((x: any) => toNum(x?.seasonNum ?? x?.season_number ?? x?.season ?? x))
            .filter((n: number | null) => n !== null) as number[];

        // se vuoto, ritorna [1] come fallback (alcune serie “specials”)
        return seasons.length ? Array.from(new Set(seasons)).sort((a, b) => a - b) : [];
    }

    /**
     * Episodi per sezione (opzionale: filtrando per stagione)
     */
    async episodes(
        cookies: string[],
        section: any,
        season?: number
    ): Promise<any[]> {
        const sectionId =
            section?.section_id ?? section?.sectionId ?? section?.id ?? section?.sectionID;
        if (!sectionId) return [];

        const params: Record<string, any> = { rows: 999, begin: 0 };

        if (season) {
            // pattern dell’addon Kodi: params=seasonNum=... + seasonNum=...
            params.params = `seasonNum=${season}`;
            params.seasonNum = season;
        }

        const data = await this.getJson<any>(
            `/v2.0/androidphone/videos/section/${sectionId}.json`,
            cookies,
            params
        );

        return data?.sectionItems?.itemList ?? [];
    }

    // ---------- UTIL MAPPERS (usati dal route catalog/meta) ----------

    pickImage = pickImage;
}
