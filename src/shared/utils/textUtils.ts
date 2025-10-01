export function offsetToPosition(
	content: string,
	offset: number
): { line: number; ch: number } {
	let line = 0;
	let ch = 0;

	for (let i = 0; i < Math.min(offset, content.length); i++) {
		if (content[i] === "\n") {
			line++;
			ch = 0;
		} else {
			ch++;
		}
	}

	return { line, ch };
}

export function extractChunkPreview(
	content: string,
	startOffset: number,
	endOffset: number
): string {
	if (startOffset === -1 && endOffset === -1) {
		return "empty";
	}

	if (startOffset != null && endOffset != null) {
		return content.substring(startOffset, endOffset);
	}

	return "No position info for preview.";
}
