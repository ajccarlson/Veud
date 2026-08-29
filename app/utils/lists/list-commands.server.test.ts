import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

function sourceFiles(directory: string): string[] {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const target = path.join(directory, entry.name)
		return entry.isDirectory()
			? sourceFiles(target)
			: /\.[cm]?[jt]sx?$/.test(entry.name)
				? [target]
				: []
	})
}

function importsRetiredListAdapter(source: string) {
	const retiredDirectory = ['lists+/', '.fetch+/'].join('')
	const specifiers = source.matchAll(
		/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g,
	)
	return Array.from(specifiers, match => match[1]).some(specifier =>
		specifier.includes(retiredDirectory),
	)
}

test('retired boundary recognizes static, dynamic, and relative imports only', () => {
	const retired = ['lists+/', '.fetch+/old.ts'].join('')
	expect(
		importsRetiredListAdapter(`import value from '#app/routes/${retired}'`),
	).toBe(true)
	expect(
		importsRetiredListAdapter(`const value = import('../routes/${retired}')`),
	).toBe(true)
	expect(
		importsRetiredListAdapter(`const value = require('../routes/${retired}')`),
	).toBe(true)
	expect(
		importsRetiredListAdapter(
			"expect(path.startsWith('/lists/fetch/')).toBe(false)",
		),
	).toBe(false)
})

test('application code does not import retired list route adapters', () => {
	const imports = ['app', 'scripts', 'tests'].flatMap(directory =>
		sourceFiles(path.join(process.cwd(), directory)).flatMap(file => {
			const source = fs.readFileSync(file, 'utf8')
			return importsRetiredListAdapter(source) ? [file] : []
		}),
	)

	expect(imports).toEqual([])
})
