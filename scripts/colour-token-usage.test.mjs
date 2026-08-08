import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const root = process.cwd()

function sourceFiles(directory) {
	const found = []
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name)
		if (entry.isDirectory()) found.push(...sourceFiles(full))
		else if (/\.tsx?$/.test(entry.name)) found.push(full)
	}
	return found
}

const sources = sourceFiles(path.join(root, 'app'))
const stylesheet = fs.readFileSync(
	path.join(root, 'app/styles/tailwind.css'),
	'utf8',
)

test('every veud token a component uses is actually defined', () => {
	// `--veud-mint-text` was referenced in two places and defined nowhere, so
	// those elements silently fell back to inherited colour.
	const defined = new Set(
		[...stylesheet.matchAll(/(--veud-[a-z0-9-]+):/g)].map(match => match[1]),
	)
	const missing = new Map()
	for (const file of sources) {
		for (const match of fs
			.readFileSync(file, 'utf8')
			.matchAll(/var\((--veud-[a-z0-9-]+)\)/g)) {
			if (!defined.has(match[1])) {
				missing.set(match[1], path.relative(root, file))
			}
		}
	}
	expect(Object.fromEntries(missing)).toEqual({})
})

test('colour tokens are composed with rgb(), never used bare', () => {
	// The tokens are bare RGB triples, so `color: var(--veud-mint)` resolves to
	// `color: 143 235 190` — invalid, and dropped by the browser in both themes.
	const bare = []
	for (const file of sources) {
		for (const match of fs
			.readFileSync(file, 'utf8')
			.matchAll(
				/(text|bg|border|ring|from|to|via)-\[var\((--veud-[a-z0-9-]+)\)\]/g,
			)) {
			bare.push(`${path.relative(root, file)}: ${match[0]}`)
		}
	}
	expect(bare).toEqual([])
})
