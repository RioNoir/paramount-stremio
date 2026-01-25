import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ProxyAgent } from 'proxy-agent';

export class HttpClient {
    private client: AxiosInstance;

    constructor() {
        const proxyUrl = process.env.HTTP_PROXY;

        const agent = proxyUrl
            ? new ProxyAgent({ getProxyForUrl: () => proxyUrl })
            : new ProxyAgent();

        this.client = axios.create({
            timeout: 30000,
            httpAgent: agent,
            httpsAgent: agent,
            proxy: false,
            validateStatus: (status) => status < 500
        });
    }

    private async baseRequest(config: AxiosRequestConfig) : Promise<{
        status: number;
        data: any;
        headers: Headers;
        cookies: string[];
    }> {
        try {
            const response = await this.client.request(config);
            const responseHeaders = new Headers();
            Object.entries(response.headers).forEach(([key, value]) => {
                if (Array.isArray(value)) {
                    value.forEach(v => responseHeaders.append(key, v));
                } else if (value) {
                    responseHeaders.set(key, value as string);
                }
            });

            return {
                status: response.status,
                data: response.data,
                headers: responseHeaders,
                cookies: response.headers['set-cookie'] || [],
            };
        } catch (error: any) {
            this.handleError(error, config.url || 'unknown');
            throw error;
        }
    }

    public async get(url: string, config: AxiosRequestConfig = {}) {
        return this.baseRequest({
            method: 'GET',
            url: url,
            ...config
        });
    }

    public async post(url: string, body?: any, config: AxiosRequestConfig = {}) {
        return this.baseRequest({
            method: 'POST',
            url: url,
            data: body,
            ...config
        });
    }

    public async put(url: string, body?: any, config: AxiosRequestConfig = {}) {
        return this.baseRequest({
            method: 'PUT',
            url: url,
            data: body,
            ...config
        });
    }

    private handleError(error: any, url: string) {
        if (error.code === 'ECONNABORTED') {
            console.error(`[TIMEOUT] Request to ${url} expired.`);
        } else if (error.code === 'ERR_BAD_RESPONSE') {
            console.error(`[PROXY] SOCKS5/HTTP Proxy connection refused or protocol error.`);
        } else {
            console.error(`[ERROR] ${url}:`, error.message);
        }
    }
}

const globalForHttpClient = global as unknown as {
    httpClient: HttpClient | undefined;
};
export const httpClient = globalForHttpClient.httpClient ?? new HttpClient();
// if (process.env.NODE_ENV !== "production") {
//     globalForHttpClient.httpClient = httpClient;
// }
