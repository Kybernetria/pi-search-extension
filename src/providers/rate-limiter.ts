/**
 * Inline utilities used by all search providers.
 * Inlined from pi-fi/shared/ to avoid cross-repo dependencies.
 * Source: pi-fi/shared/fetch_retry.ts, pi-fi/shared/rate_limiter.ts
 */

export async function fetchWithRetry(
	url: string,
	options?: RequestInit,
	maxRetries = 2,
	baseDelayMs = 1000,
): Promise<Response> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(url, options);
			if (res.ok || res.status < 500) return res;
			lastError = new Error(`HTTP ${res.status}`);
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
		}
		if (attempt < maxRetries) {
			await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
		}
	}
	throw lastError ?? new Error("fetchWithRetry: all attempts failed");
}

export function createRateLimiter(maxPerMinute: number) {
	const timestamps: number[] = [];
	return async function waitForToken(): Promise<void> {
		const now = Date.now();
		while (timestamps.length > 0 && timestamps[0] < now - 60_000) timestamps.shift();
		if (timestamps.length >= maxPerMinute) {
			const waitMs = timestamps[0] + 60_000 - now;
			await new Promise(r => setTimeout(r, waitMs));
		}
		timestamps.push(Date.now());
	};
}
