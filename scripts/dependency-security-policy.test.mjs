import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
)
const packageJson = JSON.parse(
	fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
)
const packageLock = JSON.parse(
	fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
)
const require = createRequire(import.meta.url)

function dependencyVersions(name) {
	const suffix = `/node_modules/${name}`
	return Object.entries(packageLock.packages)
		.filter(
			([location]) =>
				location === `node_modules/${name}` || location.endsWith(suffix),
		)
		.map(([location, descriptor]) => ({
			location,
			version: descriptor.version,
		}))
}

test('security overrides use compatible patched dependency lines', () => {
	assert.equal(packageJson.scripts?.postinstall, undefined)
	assert.equal(packageJson.overrides['brace-expansion'], '5.0.9')
	assert.equal(packageJson.overrides['deepmerge-ts'], '8.0.0')
	assert.equal(packageJson.overrides['js-yaml'], '4.3.1')
	assert.deepEqual(packageJson.overrides['minimatch@3.1.5'], {
		'brace-expansion': '2.1.4',
	})
	assert.equal(packageJson.overrides.nanoid, '3.3.18')
})

test('the lockfile contains no alerted dependency version', () => {
	assert.deepEqual(
		new Set(
			dependencyVersions('brace-expansion').map(({ version }) => version),
		),
		new Set(['2.1.4', '5.0.9']),
	)
	assert.deepEqual(
		new Set(dependencyVersions('js-yaml').map(({ version }) => version)),
		new Set(['4.3.1']),
	)
	assert.deepEqual(
		new Set(dependencyVersions('deepmerge-ts').map(({ version }) => version)),
		new Set(['8.0.0']),
	)
	assert.deepEqual(
		new Set(dependencyVersions('nanoid').map(({ version }) => version)),
		new Set(['3.3.18']),
	)
})

test('legacy and modern glob consumers work without rewriting installed source', () => {
	const legacyRequire = createRequire(require.resolve('@eslint/eslintrc'))
	const legacyMinimatch = legacyRequire('minimatch')
	assert.equal(legacyMinimatch('catalog.ts', '*.ts'), true)

	const { globSync } = require('glob')
	assert.ok(
		globSync('package*.json', { cwd: repositoryRoot }).includes('package.json'),
	)
})

test('Prisma config can use the patched deepmerge export', async () => {
	const { deepmerge } = await import('deepmerge-ts')
	assert.deepEqual(
		deepmerge(
			{ datasource: { url: 'first' } },
			{ datasource: { provider: 'sqlite' } },
		),
		{ datasource: { url: 'first', provider: 'sqlite' } },
	)
})
