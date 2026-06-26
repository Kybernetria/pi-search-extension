/**
 * Minimal local copy of pi-common's JSON sanitization helper.
 * Keeps this extension standalone and avoids depending on pi-bakery packages.
 */
function consumeHighSurrogate(raw: string, i: number): { text: string; advance: number } {
	const next = raw.charCodeAt(i + 1);
	if (next >= 0xdc00 && next <= 0xdfff) return { text: raw[i] + raw[i + 1], advance: 2 };
	return { text: "\uFFFD", advance: 1 };
}

function processOutsideString(
	raw: string,
	i: number,
	code: number,
): { text: string; advance: number; enterString: boolean } {
	if (code === 0x22) return { text: '"', advance: 1, enterString: true };
	if (code >= 0xd800 && code <= 0xdbff) return { ...consumeHighSurrogate(raw, i), enterString: false };
	if (code >= 0xdc00 && code <= 0xdfff) return { text: "\uFFFD", advance: 1, enterString: false };
	return { text: raw[i], advance: 1, enterString: false };
}

function processInsideString(
	raw: string,
	i: number,
	code: number,
): { text: string; advance: number; exitString: boolean } {
	if (code === 0x22) return { text: '"', advance: 1, exitString: true };
	if (code === 0x5c) {
		const escaped = i + 1 < raw.length ? raw[i + 1] : "";
		return { text: "\\" + escaped, advance: escaped ? 2 : 1, exitString: false };
	}
	if (code === 0x0000) return { text: "", advance: 1, exitString: false };
	if (code >= 0x0001 && code <= 0x001f) {
		return { text: "\\u" + code.toString(16).padStart(4, "0"), advance: 1, exitString: false };
	}
	if (code >= 0xd800 && code <= 0xdbff) return { ...consumeHighSurrogate(raw, i), exitString: false };
	if (code >= 0xdc00 && code <= 0xdfff) return { text: "\uFFFD", advance: 1, exitString: false };
	return { text: raw[i], advance: 1, exitString: false };
}

export function sanitizeForJsonParse(raw: string): string {
	let out = "";
	let inString = false;
	let i = 0;
	while (i < raw.length) {
		const code = raw.charCodeAt(i);
		if (!inString) {
			const r = processOutsideString(raw, i, code);
			out += r.text;
			i += r.advance;
			if (r.enterString) inString = true;
		} else {
			const r = processInsideString(raw, i, code);
			out += r.text;
			i += r.advance;
			if (r.exitString) inString = false;
		}
	}
	return out;
}
