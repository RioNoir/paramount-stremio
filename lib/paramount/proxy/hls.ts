
export function splitMasterPlaylist(masterM3u8: string, baseUrl: string = "") {
    const lines = masterM3u8.split("\n");
    const variants: any[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF")) {
            const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || "0");
            const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1] || "unknown";
            const height = resolution.split("x")[1] || "unknown";
            let url = lines[i + 1]?.trim();

            if (url && !url.startsWith("#") && resolution !== "unknown") {
                if (!url.startsWith("http") && baseUrl) {
                    url = new URL(url, baseUrl).toString();
                }
                variants.push({ height, bandwidth, resolution, url });
            }
        }
    }

    variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
    const finalVariants = variants.map((v, index, self) => {
        const sameHeight = self.filter(x => x.height === v.height);
        let label = `${v.height}p`;

        if (sameHeight.length > 1) {
            // Se è il primo dei duplicati (essendo ordinati per bandwidth), è il più alto
            const isHighest = sameHeight[0].bandwidth === v.bandwidth;
            const isLowest = sameHeight[sameHeight.length - 1].bandwidth === v.bandwidth;

            if (isHighest) label += " - High";
            else if (isLowest && sameHeight.length > 1) label += " - Low";
            else label += ` (${Math.round(v.bandwidth / 1000)}k)`;
        }

        return {
            quality: label,
            url: v.url,
            bandwidth: v.bandwidth,
            resolution: v.resolution
        };
    });

    return finalVariants;
}

export function filterMasterByClosestBandwidth(masterM3u8: string, targetBandwidth: number): string {
    const lines = masterM3u8.split("\n");
    const videoVariants: { info: string; url: string; bw: number }[] = [];
    const otherTags: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.startsWith("#EXT-X-STREAM-INF")) {
            const bw = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || "0");
            const url = lines[i + 1]?.trim();
            if (url && !url.startsWith("#")) {
                videoVariants.push({ info: line, url, bw });
                i++;
            }
        } else {
            otherTags.push(line);
        }
    }

    if (videoVariants.length === 0) return masterM3u8;
    const closestVariant = videoVariants.reduce((prev, curr) => {
        return Math.abs(curr.bw - targetBandwidth) < Math.abs(prev.bw - targetBandwidth) ? curr : prev;
    });

    let output = "";
    const headerTags = otherTags.filter(t => t.startsWith("#EXTM3U") || t.startsWith("#EXT-X-VERSION"));
    const mediaTags = otherTags.filter(t => t.startsWith("#EXT-X-MEDIA"));
    const globalTags = otherTags.filter(t => !t.startsWith("#EXTM3U") && !t.startsWith("#EXT-X-VERSION") && !t.startsWith("#EXT-X-MEDIA"));

    output += headerTags.join("\n") + "\n";
    output += mediaTags.join("\n") + "\n";
    output += globalTags.join("\n") + "\n";

    output += `${closestVariant.info}\n${closestVariant.url}\n`;

    return output;
}

export function rewriteM3U8(params: {
    text: string;
    upstreamUrl: URL;
    baseOrigin: string;
    key: string;
    token: string;
}) {
    const { text, upstreamUrl, baseOrigin, key, token } = params;

    const toProxy = (absUrl: string, route: string = "seg") => {
        const isManifest = absUrl.includes(".m3u8");
        const endpoint = isManifest ? "hls" : route;
        const u = new URL(`/api/stremio/${key}/proxy/${endpoint}`, baseOrigin);
        u.searchParams.set("u", Buffer.from(absUrl.toString()).toString('base64url'));
        u.searchParams.set("t", token);
        return u.toString();
    };

    const lines = text.split("\n");

    // --- MASTER MANIFEST ---
    if (text.includes("#EXT-X-STREAM-INF")) {
        const headerLines: string[] = [];
        const streamInfVariants: { bandwidth: number; info: string; url: string }[] = [];
        const frameStreamInfVariants: { bandwidth: number; info: string;}[] = [];
        const footerLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            if (line.startsWith("#EXT-X-STREAM-INF")) {
                const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

                const nextLine = lines[i + 1]?.trim();
                if (nextLine && !nextLine.startsWith("#")) {
                    streamInfVariants.push({
                        bandwidth,
                        info: line,
                        url: toProxy(new URL(nextLine, upstreamUrl).toString())
                    });
                    i++;
                }
            } else if (line.startsWith("#EXT-X-I-FRAME-STREAM-INF")) {
                const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

                const uriMatch = line.match(/URI=["']([^"']+)["']/);
                if (uriMatch) {
                    const absUri = new URL(uriMatch[1], upstreamUrl).toString();
                    line = line.replace(uriMatch[1], toProxy(absUri));
                }

                frameStreamInfVariants.push({
                    bandwidth,
                    info: line
                });
            } else if (line.startsWith("#EXT-X-KEY")) {
                const uriMatch = line.match(/URI=["']([^"']+)["']/);
                if (uriMatch) {
                    const absUri = new URL(uriMatch[1], upstreamUrl).toString();
                    line = line.replace(uriMatch[1], toProxy(absUri, 'license'));
                }
                headerLines.push(line);
            } else if (line.startsWith("#EXT")) {
                const uriMatch = line.match(/URI=["']([^"']+)["']/);
                if (uriMatch) {
                    const absUri = new URL(uriMatch[1], upstreamUrl).toString();
                    line = line.replace(uriMatch[1], toProxy(absUri));
                }
                headerLines.push(line);
            }
        }

        const forceHq = process.env.FORCE_HQ === "true";
        if(forceHq) {
            streamInfVariants.sort((a, b) => b.bandwidth - a.bandwidth);
            frameStreamInfVariants.sort((a, b) => b.bandwidth - a.bandwidth);
        }

        const outMaster = [...headerLines];
        streamInfVariants.forEach(v => {
            outMaster.push(v.info);
            outMaster.push(v.url);
        });
        frameStreamInfVariants.forEach(v => {
            outMaster.push(v.info);
        });
        outMaster.push(...footerLines);

        return outMaster.join("\n");
    }

    // --- MEDIA PLAYLIST ---
    const outMedia: string[] = [];
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith("#EXT")) {
            const m = line.match(/URI=["']([^"']+)["']/);
            if (m) {
                const absKey = new URL(m[1], upstreamUrl).toString();
                line = line.replace(m[1], toProxy(absKey));
            }
            outMedia.push(line);
            continue;
        }

        if (!line.startsWith("#")) {
            try {
                outMedia.push(toProxy(new URL(line, upstreamUrl).toString()));
            } catch {
                outMedia.push(line);
            }
        } else {
            outMedia.push(line);
        }
    }
    return outMedia.join("\n");
}