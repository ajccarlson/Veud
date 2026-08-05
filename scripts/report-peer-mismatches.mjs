#!/usr/bin/env node
/**
 * List dependencies whose declared peer ranges the installed tree does not
 * satisfy.
 *
 * `.npmrc` sets `legacy-peer-deps=true` — necessary, because one dependency
 * declares an unsatisfiable peer — but it switches peer checking off for
 * everything, so a genuinely incompatible install succeeds without a word.
 * This puts the list back, without making it a gate: some mismatches are
 * expected and permanent.
 */
import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'

const root = process.cwd()
const manifest = JSON.parse(
	fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
)
const declared = {
	...manifest.dependencies,
	...manifest.devDependencies,
}

function installedVersion(name) {
	try {
		return JSON.parse(
			fs.readFileSync(
				path.join(root, 'node_modules', name, 'package.json'),
				'utf8',
			),
		).version
	} catch {
		return null
	}
}

/**
 * Real range satisfaction, not an approximation. A first attempt compared major
 * versions by hand and reported `react@>=18` against React 19 as a mismatch,
 * which is exactly the kind of noise that teaches people to ignore a report.
 */
function satisfied(installed, range) {
	// A range npm understands but semver does not — `>=3.0.0 || insiders`, a
	// URL, a dist-tag — cannot be judged here. semver scores those `false`
	// rather than throwing, so an unjudgeable range would be reported as a
	// mismatch and the report would be noise from its first run.
	if (!semver.validRange(range, { includePrerelease: true })) return true
	try {
		return semver.satisfies(installed, range, { includePrerelease: true })
	} catch {
		return true
	}
}

const mismatches = []
for (const name of Object.keys(declared)) {
	let peers
	try {
		peers = JSON.parse(
			fs.readFileSync(
				path.join(root, 'node_modules', name, 'package.json'),
				'utf8',
			),
		).peerDependencies
	} catch {
		continue
	}
	if (!peers) continue
	for (const [peer, range] of Object.entries(peers)) {
		const installed = installedVersion(peer)
		if (!installed) continue
		if (!satisfied(installed, range)) {
			mismatches.push({ name, peer, range, installed })
		}
	}
}

if (!mismatches.length) {
	console.log('No peer mismatches that legacy-peer-deps is hiding.')
} else {
	console.log(
		`${mismatches.length} peer mismatch${mismatches.length === 1 ? '' : 'es'} accepted because legacy-peer-deps is on:`,
	)
	for (const entry of mismatches) {
		console.log(
			`  ${entry.name} wants ${entry.peer}@${entry.range}, installed ${entry.installed}`,
		)
	}
}
