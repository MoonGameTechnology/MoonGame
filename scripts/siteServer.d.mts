/** Types for `siteServer.mjs`: the game server baked into the Cloudflare site. */
export declare function parseServer(raw: string | undefined): string | undefined;
export declare function bakeServer(html: string, server: string | undefined): string;
