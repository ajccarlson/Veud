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
	{
		label: 'profile overview route JavaScript',
		pattern: /^_username\.index-[\w-]+\.js$/,
		rawBytes: 135 * 1024,
		gzipBytes: 42 * 1024,
	},
	{
		label: 'profile stats route JavaScript',
		pattern: /^_username\.stats-[\w-]+\.js$/,
		rawBytes: 12 * 1024,
		gzipBytes: 5 * 1024,
	},
	{
		label: 'profile watchlist chart JavaScript',
		pattern: /^watchlist-(?!grid-)[\w-]+\.js$/,
		rawBytes: 35 * 1024,
		gzipBytes: 12 * 1024,
	},
	{
		label: 'profile pie chart JavaScript',
		pattern: /^pie-[\w-]+\.js$/,
		rawBytes: 30 * 1024,
		gzipBytes: 12 * 1024,
	},
	{
		label: 'profile bar chart JavaScript',
		pattern: /^bar-[\w-]+\.js$/,
		rawBytes: 45 * 1024,
		gzipBytes: 15 * 1024,
	},
	{
		label: 'profile box plot chart JavaScript',
		pattern: /^box_plot-[\w-]+\.js$/,
		rawBytes: 35 * 1024,
		gzipBytes: 12 * 1024,
	},
	{
		label: 'profile line chart JavaScript',
		pattern: /^line-[\w-]+\.js$/,
		rawBytes: 70 * 1024,
		gzipBytes: 22 * 1024,
		selectLargest: true,
	},
	{
		label: 'profile chord chart JavaScript',
		pattern: /^chord-[\w-]+\.js$/,
		rawBytes: 40 * 1024,
		gzipBytes: 14 * 1024,
	},
	{
		label: 'profile radial chart JavaScript',
		pattern: /^radial_bar-[\w-]+\.js$/,
		rawBytes: 30 * 1024,
		gzipBytes: 10 * 1024,
	},
	{
		label: 'profile calendar chart JavaScript',
		pattern: /^calendar-[\w-]+\.js$/,
		rawBytes: 40 * 1024,
		gzipBytes: 14 * 1024,
		selectLargest: true,
	},
	{
		label: 'shared Nivo theme JavaScript',
		pattern: /^nivo-theme-[\w-]+\.js$/,
		rawBytes: 210 * 1024,
		gzipBytes: 75 * 1024,
	},
]

let failed = false

for (const budget of budgets) {
	const matches = files.filter(file => budget.pattern.test(file))
	const hasExpectedMatches = budget.selectLargest
		? matches.length >= 1
		: matches.length === 1
	if (!hasExpectedMatches) {
		console.error(
			`Expected ${budget.selectLargest ? 'at least one' : 'one'} ${budget.label} asset, found ${matches.length}: ${matches.join(', ') || 'none'}`,
		)
		failed = true
		continue
	}

	const sizes = await Promise.all(
		matches.map(async file => ({
			file,
			rawBytes: (await stat(path.join(assetsDirectory, file))).size,
		})),
	)
	const selected = budget.selectLargest
		? sizes.sort((a, b) => b.rawBytes - a.rawBytes)[0]
		: sizes[0]
	const file = selected.file
	const filePath = path.join(assetsDirectory, file)
	const rawBytes = selected.rawBytes
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
