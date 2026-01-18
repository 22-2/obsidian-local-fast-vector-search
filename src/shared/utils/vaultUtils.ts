import { App } from "obsidian";

export function getUserIgnoreFilters(app: App): string[] {
	const filters = (app.vault as any)?.getConfig?.("userIgnoreFilters");
	if (!Array.isArray(filters)) {
		return [];
	}
	return filters
		.filter((filter) => typeof filter === "string")
		.map((filter) => filter.trim())
		.filter((filter) => filter.length > 0);
}

export function isPathIgnoredByUserFilters(app: App, path: string): boolean {
	const ignoreFilters = getUserIgnoreFilters(app);
	if (ignoreFilters.length === 0) {
		return false;
	}

	const normalizedPath = path.replace(/\\/g, "/");
	return ignoreFilters.some((filter) => {
		const normalizedFilter = filter.replace(/\\/g, "/");
		return normalizedPath.startsWith(normalizedFilter);
	});
}
