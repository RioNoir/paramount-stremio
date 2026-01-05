import { spawn } from 'child_process';
import { readSessionFromKey } from "@/lib/auth/session";
import { unseal } from "@/lib/auth/jwe";
import { NextRequest, NextResponse } from "next/server";

async function handle(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
    const { key } = await ctx.params;

    const session = await readSessionFromKey(decodeURIComponent(key));
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const u = req.nextUrl.searchParams.get("u");
    const t = req.nextUrl.searchParams.get("t");
    const q = req.nextUrl.searchParams.get("q");
    if (!u || !t) return new NextResponse("Missing u/t", { status: 400 });

    const tok: any = await unseal(t);
    if (!tok || tok.kind !== "pplus_proxy" || !tok.ls_session) {
        return new NextResponse("Bad token", { status: 401 });
    }

    let upstreamUrl: URL;
    try {
        upstreamUrl = new URL(Buffer.from(u, 'base64url').toString('utf-8'));
    } catch {
        return new NextResponse("Bad upstream url", { status: 400 });
    }

    const args: string[] = [];

    args.push('--stdout');
    args.push('--hls-live-restart');
    args.push('--hls-segment-stream-data')
    //args.push('--hls-segment-ignore-names', '0,1,2')
    //args.push('--hls-segment-ignore', 'dai.google.com,doubleclick.net');
    //args.push('--hls-segment-threads', '3');
    args.push('--stream-segment-threads', '3');
    args.push('--hls-live-edge', '1');

    //FFmpeg
    args.push('--ffmpeg-ffmpeg', '/usr/bin/ffmpeg');
    args.push('--ffmpeg-fout', 'mpegts');
    args.push('--ffmpeg-video-transcode', 'copy');
    args.push('--ffmpeg-audio-transcode', 'copy');
    //args.push('--ffmpeg-video-transcode', 'h264');
    //args.push('--ffmpeg-audio-transcode', 'aac');
    //args.push('--ffmpeg-copyts');
    //args.push('--ffmpeg-verbose');

    //Headers
    args.push('--http-header', 'Cache-Control=no-store');
    //args.push('--http-header', 'User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    args.push('--http-header', 'User-Agent=AppleTV6,2/11.1');
    args.push('--http-header', 'Origin=https://www.paramountplus.com');
    args.push('--http-header', 'Referer=https://www.paramountplus.com/')
    if (tok.ls_session) {
        args.push('--http-header', `Authorization=Bearer ${tok.ls_session.trim()}`);
    }
    if (session.cookies) {
        args.push('--http-header', `Cookie=${session.cookies.toString().trim()}`);
    }

    //Url
    args.push(upstreamUrl.toString());

    //Quality
    if(q){
        args.push(q);
    }else{
        args.push('best');
    }

    //Stream
    const stream = new ReadableStream({
        start(controller) {
            const streamlink = spawn('streamlink', args);

            streamlink.stdout.on('data', (chunk) => {
                controller.enqueue(chunk);
            });

            streamlink.stderr.on('data', (data) => {
                console.log(`Streamlink: ${data}`);
            });

            streamlink.on('close', () => {
                controller.close();
            });

            streamlink.on('error', (err) => {
                console.error("Streamlink Spawn Error:", err);
                controller.error(err);
            });

            req.signal.addEventListener('abort', () => {
                console.log('Client aborted, killing streamlink...');
                streamlink.kill();
            });
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'video/mp2t',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'keep-alive',
            // --- HEADERS CORS ---
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

export async function GET(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: any) {
    return handle(req, ctx);
}