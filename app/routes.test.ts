import { type RouteConfigEntry } from '@react-router/dev/routes'
import { expect, test } from 'vitest'
import routes from './routes.ts'

type ManifestEntry = {
	file: string
	path: string
}

function joinRoutePath(parentPath: string, path: string | undefined) {
	if (!path) return parentPath
	if (path.startsWith('/')) return path.slice(1)
	return [parentPath, path].filter(Boolean).join('/').replaceAll(/\/+/g, '/')
}

function manifestEntries(
	entries: readonly RouteConfigEntry[],
	parentPath = '',
): ManifestEntry[] {
	return entries.flatMap(entry => {
		const path = entry.index
			? parentPath
			: joinRoutePath(parentPath, entry.path)
		return [
			{ file: entry.file, path },
			...manifestEntries(entry.children ?? [], path),
		]
	})
}

test('route manifest has one canonical profile stats route', () => {
	const statsRoutes = manifestEntries(routes).filter(
		entry => entry.path === 'users/:username/stats',
	)

	expect(statsRoutes).toEqual([
		{
			file: 'routes/users+/$username.stats.tsx',
			path: 'users/:username/stats',
		},
	])
})

test('provider helper modules are not exposed as empty media routes', () => {
	const entries = manifestEntries(routes)
	const files = entries.map(entry => entry.file)
	const paths = entries.map(entry => entry.path)

	for (const forbidden of [
		'routes/media+/mal.ts',
		'routes/media+/tmdb.ts',
		'routes/users+/$username_/stats_/index.tsx',
	]) {
		expect(files).not.toContain(forbidden)
	}
	for (const forbidden of ['media/mal', 'media/tmdb']) {
		expect(paths).not.toContain(forbidden)
	}
	expect(entries).toContainEqual({
		file: 'routes/media+/$mediaId.tsx',
		path: 'media/:mediaId',
	})
})
