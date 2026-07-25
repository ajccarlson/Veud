#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const repoRoot = path.resolve(import.meta.dirname, '..')
const configPath = ts.findConfigFile(repoRoot, ts.sys.fileExists, 'tsconfig.json')
if (!configPath) throw new Error('tsconfig.json was not found')

const config = ts.readConfigFile(configPath, ts.sys.readFile)
if (config.error) {
	throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
}
const parsed = ts.parseJsonConfigFileContent(
	config.config,
	ts.sys,
	path.dirname(configPath),
)
const program = ts.createProgram(parsed.fileNames, {
	...parsed.options,
	noEmit: true,
})
const checker = program.getTypeChecker()
const routeRoot = path.join(repoRoot, 'app/routes')

function isExported(node) {
	return node.modifiers?.some(
		modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
	)
}

function loaderDeclarations(sourceFile) {
	const loaders = []
	for (const statement of sourceFile.statements) {
		if (
			ts.isFunctionDeclaration(statement) &&
			statement.name?.text === 'loader' &&
			isExported(statement)
		) {
			loaders.push(statement.name)
		}
		if (ts.isVariableStatement(statement) && isExported(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (
					ts.isIdentifier(declaration.name) &&
					declaration.name.text === 'loader'
				) {
					loaders.push(declaration.name)
				}
			}
		}
	}
	return loaders
}

function symbolName(type) {
	return type.aliasSymbol?.getName() ?? type.getSymbol()?.getName() ?? ''
}

function decimalPaths(type, node, trail = 'return', depth = 0, seen = new Set()) {
	if (depth > 18 || seen.has(type)) return []
	if (symbolName(type) === 'Decimal') return [trail]
	if (
		type.flags &
		(ts.TypeFlags.StringLike |
			ts.TypeFlags.NumberLike |
			ts.TypeFlags.BooleanLike |
			ts.TypeFlags.BigIntLike |
			ts.TypeFlags.Null |
			ts.TypeFlags.Undefined |
			ts.TypeFlags.Void |
			ts.TypeFlags.Never |
			ts.TypeFlags.Any |
			ts.TypeFlags.Unknown)
	) {
		return []
	}

	const nextSeen = new Set(seen)
	nextSeen.add(type)
	const paths = []
	if (type.isUnionOrIntersection()) {
		for (const member of type.types) {
			paths.push(...decimalPaths(member, node, trail, depth + 1, nextSeen))
		}
	}
	if (type.objectFlags & ts.ObjectFlags.Reference) {
		for (const argument of checker.getTypeArguments(type)) {
			paths.push(...decimalPaths(argument, node, trail, depth + 1, nextSeen))
		}
	}

	for (const property of checker.getPropertiesOfType(type)) {
		if (paths.length >= 12) break
		const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? node
		const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
		paths.push(
			...decimalPaths(
				propertyType,
				declaration,
				`${trail}.${property.getName()}`,
				depth + 1,
				nextSeen,
			),
		)
	}
	return [...new Set(paths)].slice(0, 12)
}

const findings = []
for (const sourceFile of program.getSourceFiles()) {
	if (
		!sourceFile.fileName.startsWith(routeRoot + path.sep) ||
		sourceFile.isDeclarationFile ||
		!fs.existsSync(sourceFile.fileName)
	) {
		continue
	}
	for (const declaration of loaderDeclarations(sourceFile)) {
		const loaderType = checker.getTypeAtLocation(declaration)
		for (const signature of loaderType.getCallSignatures()) {
			const returnType = checker.getAwaitedType(signature.getReturnType())
			if (!returnType) continue
			const paths = decimalPaths(returnType, declaration)
			if (paths.length) {
				findings.push({
					file: path.relative(repoRoot, sourceFile.fileName),
					paths,
				})
			}
		}
	}
}

const result = {
	checkedRoutes: program
		.getSourceFiles()
		.filter(
			source =>
				source.fileName.startsWith(routeRoot + path.sep) &&
				!source.isDeclarationFile,
		).length,
	findings,
}

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(result, null, 2))
} else if (!findings.length) {
	console.log(
		`PASS: ${result.checkedRoutes} route modules expose no Prisma Decimal values from loader return types.`,
	)
} else {
	console.error(
		`FAIL: ${findings.length} route loader${findings.length === 1 ? '' : 's'} expose Prisma Decimal values:`,
	)
	for (const finding of findings) {
		console.error(`- ${finding.file}`)
		for (const decimalPath of finding.paths) console.error(`  ${decimalPath}`)
	}
}

if (findings.length) process.exitCode = 1
