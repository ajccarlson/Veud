import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

function walk(dir: string, match: RegExp): string[] {
	const found: string[] = []
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) found.push(...walk(full, match))
		else if (match.test(entry.name)) found.push(full)
	}
	return found
}

/** The last path segment a route renders at, or null when it is not a page. */
function pageSegment(file: string) {
	if (/\.test\.tsx?$/.test(file)) return null
	const source = fs.readFileSync(file, 'utf8')
	if (!/export default (function|\()/.test(source)) return null
	// A redirect-only route renders nothing and exists to forward the visitor
	// somewhere else, so it is not a destination that needs navigation of its own.
	if (/export default function \w+\(\) \{\s*return null\s*\}/.test(source)) {
		return null
	}
	const relative = file.replace(/^app\/routes\//, '').replace(/\.tsx$/, '')
	const segment = relative
		.replace(/\/(route|index|_index)$/, '')
		.split(/[./]/)
		.filter(Boolean)
		.pop()
	if (!segment) return null
	// Dynamic params, pathless layouts and index routes are reached through their
	// parents rather than by a link to a literal segment.
	if (/^[$_]/.test(segment) || /^(index|route)$/.test(segment)) return null
	return segment
}

test('every page is reachable from somewhere in the app', () => {
	// `/assistant` and the profile favorites and diary tabs all rendered correctly
	// but nothing linked to them, so they were reachable only by typing the URL.
	// A page nobody can navigate to is invisible to everyone except its author.
	const pages = walk('app/routes', /\.tsx$/)
		.map(file => ({ file, segment: pageSegment(file) }))
		.filter((entry): entry is { file: string; segment: string } =>
			Boolean(entry.segment),
		)
	expect(pages.length).toBeGreaterThan(20)

	const linkSources = walk('app', /\.(tsx|ts)$/)
		.filter(file => !/\.test\./.test(file))
		.map(file => fs.readFileSync(file, 'utf8'))
		.join('\n')

	const unreachable = pages
		.filter(({ segment }) => {
			const patterns = [
				new RegExp(`to=["'\`][^"'\`]*${segment}`),
				new RegExp(`href=["'\`][^"'\`]*${segment}`),
				// A link to a page under a dynamic parent is built rather than
				// written: to={`/media/${id}/cast`}. Without this the checker
				// calls every such page unreachable, which is the opposite of
				// true and teaches people to edit the checker, not the app.
				new RegExp(`to=\\{\`[^\`]*${segment}`),
				new RegExp(`to: ['"\`]${segment}['"\`]`),
				new RegExp(`redirect\\(['"\`][^'"\`]*${segment}`),
				new RegExp(`['"\`]/${segment}['"\`]`),
			]
			return !patterns.some(pattern => pattern.test(linkSources))
		})
		.map(({ file }) => file)

	expect(
		unreachable,
		`pages with no inbound link: ${unreachable.join(', ')}`,
	).toEqual([])
})
