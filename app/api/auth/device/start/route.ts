import { ParamountClient } from "@/lib/paramount/client";
import { withCors, optionsCors } from "@/lib/stremio/cors";

export function OPTIONS() { return optionsCors(); }

export async function POST() {
    const client = new ParamountClient();
    const start = await client.startDeviceAuth();

    return withCors(Response.json({
        deviceIdRaw: start.deviceIdRaw,
        deviceIdHashed: start.deviceIdHashed,
        activationCode: start.activationCode,
        deviceToken: start.deviceToken,
        createdAt: start.createdAt,
    }));
}
