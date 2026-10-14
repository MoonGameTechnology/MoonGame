/** Types for `siteHeaders.mjs`: security headers of the Cloudflare static site. */
export declare function pagePolicy(html: string): string;
export declare const COMMON_HEADERS: Record<string, string>;
export declare function pagePaths(published: string): string[];
export declare function headersFile(pages: Record<string, string>): string;
