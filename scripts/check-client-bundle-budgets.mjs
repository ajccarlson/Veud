import { gzipSync } from 'node:zlib'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const assetsDirectory = path.resolve('build/client/assets')
const files = await readdir(assetsDirectory)

const budgets = [
	{
		label: 'watchlist route JavaScript',
		pattern: /^_watchlist-[\w-]+\.js$/,
		rawBytes: 12 * 1024,
		gzipBytes: 5 * 1024,
	},
	{
		label: 'watchlist route CSS',
		pattern: /^_watchlist-[\w-]+\.css$/,
		rawBytes: 30 * 1024,
		gzipBytes: 8 * 1024,
	},
	{
		label: 'mobile watchlist JavaScript',
		pattern: /^mobile-watchlist-cards-[\w-]+\.js$/,
		rawBytes: 15 * 1024,
		gzipBytes: 6 * 1024,
	},
	{
		label: 'deferred advanced editor JavaScript',
		pattern: /^advanced-entry-editor-[\w-]+\.js$/,
		rawBytes: 20 * 1024,
		gzipBytes: 8 * 1024,
	},
	{
		label: 'desktop watchlist JavaScript',
		pattern: /^watchlist-grid-[\w-]+\.js$/,
		rawBytes: 950 * 1024,
		gzipBytes: 250 * 1024,
	},
	{
		label: 'desktop watchlist CSS',
		pattern: /^watchlist-grid-[\w-]+\.css$/,
		rawBytes: 230 * 1024,
		gzipBytes: 45 * 1024,
	},
]

let failed = false

for (const budget of budgets) {
	const matches = files.filter(file => budget.pattern.test(file))
	if (matches.length !== 1) {
		console.error(
			`Expected one ${budget.label} asset, found ${matches.length}: ${matches.join(', ') || 'none'}`,
		)
		failed = true
		continue
	}

	const file = matches[0]
	const filePath = path.join(assetsDirectory, file)
	const rawBytes = (await stat(filePath)).size
	const gzipBytes = gzipSync(await readFile(filePath)).byteLength
	const withinBudget =
		rawBytes <= budget.rawBytes && gzipBytes <= budget.gzipBytes

	console.log(
		`${withinBudget ? 'PASS' : 'FAIL'} ${budget.label}: ${file} ` +
			`(${(rawBytes / 1024).toFixed(1)} KiB raw, ${(gzipBytes / 1024).toFixed(1)} KiB gzip)`,
	)

	if (!withinBudget) {
		console.error(
			`Budget: ${(budget.rawBytes / 1024).toFixed(0)} KiB raw, ` +
				`${(budget.gzipBytes / 1024).toFixed(0)} KiB gzip`,
		)
		failed = true
	}
}

if (failed) process.exitCode = 1
