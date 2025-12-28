import { Agent } from "undici";

export const keepAliveAgent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 128,
    pipelining: 1,
});
