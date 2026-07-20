import { z } from 'zod'

export const MediaIdentitySchema = z
	.object({
		provider: z.enum(['tmdb', 'mal']),
		kind: z.enum(['movie', 'tv', 'anime', 'manga']),
		externalId: z.string().regex(/^\d+$/).max(20),
	})
	.strict()

export type MediaIdentity = z.infer<typeof MediaIdentitySchema>

export function mediaIdentityForTmdb(
	externalId: string | number,
	type: string,
): MediaIdentity | null {
	const normalizedType = type.toLowerCase().replace(/[^a-z0-9]/g, '')
	const kind = normalizedType.includes('movie')
		? 'movie'
		: normalizedType.includes('tv')
			? 'tv'
			: null

	return kind
		? MediaIdentitySchema.parse({
				provider: 'tmdb',
				kind,
				externalId: String(externalId),
			})
		: null
}

export function mediaIdentityForMal(
	externalId: string | number,
	kind: 'anime' | 'manga',
): MediaIdentity {
	return MediaIdentitySchema.parse({
		provider: 'mal',
		kind,
		externalId: String(externalId),
	})
}

export function mediaIdentityMatchesListType(
	identity: MediaIdentity,
	listTypeName: string,
) {
	if (listTypeName === 'liveaction') {
		return (
			identity.provider === 'tmdb' &&
			(identity.kind === 'movie' || identity.kind === 'tv')
		)
	}
	if (listTypeName === 'anime') {
		return identity.provider === 'mal' && identity.kind === 'anime'
	}
	if (listTypeName === 'manga') {
		return identity.provider === 'mal' && identity.kind === 'manga'
	}
	return false
}

/**
 * Read the provider identity from the external link embedded after the final
 * `|` in a legacy thumbnail value.
 */
export function mediaIdentityFromThumbnail(
	thumbnail: string | null | undefined,
): MediaIdentity | null {
	if (!thumbnail) return null
	const separatorIndex = thumbnail.lastIndexOf('|')
	if (separatorIndex < 0) return null

	let url: URL
	try {
		url = new URL(thumbnail.slice(separatorIndex + 1))
	} catch {
		return null
	}

	const host = url.hostname.toLowerCase().replace(/^www\./, '')
	const segments = url.pathname.split('/').filter(Boolean)

	if (host === 'themoviedb.org') {
		const kindIndex = segments.findIndex(
			segment => segment === 'movie' || segment === 'tv',
		)
		const kind = segments[kindIndex]
		const externalId = segments[kindIndex + 1]
		if ((kind === 'movie' || kind === 'tv') && externalId) {
			const result = MediaIdentitySchema.safeParse({
				provider: 'tmdb',
				kind,
				externalId,
			})
			return result.success ? result.data : null
		}
	}

	if (host === 'myanimelist.net') {
		const kindIndex = segments.findIndex(
			segment => segment === 'anime' || segment === 'manga',
		)
		const kind = segments[kindIndex]
		const externalId = segments[kindIndex + 1]
		if ((kind === 'anime' || kind === 'manga') && externalId) {
			const result = MediaIdentitySchema.safeParse({
				provider: 'mal',
				kind,
				externalId,
			})
			return result.success ? result.data : null
		}
	}

	return null
}
