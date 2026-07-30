import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const source = fs.readFileSync(
	path.join(process.cwd(), 'app/routes/users+/$username.tsx'),
	'utf8',
)

/** Tab targets declared in the profile shell. */
function declaredTabs() {
	const block = /const PROFILE_TABS = \[(.*?)\] as const/s.exec(source)?.[1]
	if (!block) throw new Error('PROFILE_TABS not found')
	return [...block.matchAll(/to: '([^']+)'/g)].map(match => match[1])
}

test('every profile tab route is reachable from the profile navigation', () => {
	// `$username.favorites.tsx` existed and rendered correctly, but nothing linked
	// to it: the page was only reachable by typing the URL. A profile tab route
	// that no tab points at is dead weight to everyone but the person who wrote it.
	const routeDir = path.join(process.cwd(), 'app/routes/users+')
	const tabRoutes = fs
		.readdirSync(routeDir)
		.filter(name => /^\$username\.[a-z-]+\.tsx$/.test(name))
		.map(name => name.replace('$username.', '').replace('.tsx', ''))
		.filter(name => name !== 'index')

	const knownUnreachable: string[] = []

	const tabs = declaredTabs()
	const unreachable = tabRoutes.filter(
		route => !tabs.includes(route) && !knownUnreachable.includes(route),
	)
	expect(
		unreachable,
		`profile routes with no navigation: ${unreachable.join(', ')}`,
	).toEqual([])
})

test('favorites and diary are reachable profile tabs', () => {
	// Both rendered correctly but nothing linked to them, so they existed only for
	// whoever knew the URL.
	expect(declaredTabs()).toContain('favorites')
	expect(declaredTabs()).toContain('diary')
})
