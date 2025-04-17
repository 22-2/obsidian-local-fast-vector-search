export function splitTextToSentences(text: string): string[] {
	return text
		.split(/\n+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}
