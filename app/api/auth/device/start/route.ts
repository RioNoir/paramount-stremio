import { ParamountClient } from "@/lib/paramount/client";
import { seal, type PendingPayload } from "@/lib/auth/jwe";
import { withCors, optionsCors } from "@/lib/stremio/cors";

export function OPTIONS() { return optionsCors(); }

export async function POST() {
    const client = new ParamountClient();
    const start = await client.startDeviceAuth();

    const payload: PendingPayload = {
        kind: "pending",
        createdAt: Date.now(),
        deviceIdRaw: start.deviceIdRaw,
        deviceIdHashed: start.deviceIdHashed,
        activationCode: start.activationCode,
        deviceToken: start.deviceToken,
    };

    const pendingToken = await seal(payload);

    return withCors(Response.json({
        activationCode: start.activationCode,
        activateUrl: "https://www.paramountplus.com/activate/",
        pendingToken,
    }));
}
