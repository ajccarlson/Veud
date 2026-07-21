export const mediaKindToListType = {
	movie: 'liveaction',
	tv: 'liveaction',
	anime: 'anime',
	manga: 'manga',
} as const

export type SupportedMediaKind = keyof typeof mediaKindToListType
export type SupportedListTypeName = (typeof mediaKindToListType)[SupportedMediaKind]

export function listTypeNameForMediaKind(kind: string) {
	return mediaKindToListType[kind as SupportedMediaKind] ?? null
}

export function mediaKindMatchesListType(
	kind: string,
	listTypeName: string,
) {
	return listTypeNameForMediaKind(kind) === listTypeName
}

export function providerMatchesMediaKind(provider: string, kind: string) {
	if (provider === 'tmdb') return kind === 'movie' || kind === 'tv'
	if (provider === 'mal') return kind === 'anime' || kind === 'manga'
	return false
}
