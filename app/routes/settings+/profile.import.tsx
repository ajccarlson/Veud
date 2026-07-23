import { type SEOHandle } from '@nasa-gcn/remix-seo'
import {
	data as json,
	Form,
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	useActionData,
} from 'react-router'
import { z } from 'zod'
import { Button } from '#app/components/ui/button.tsx'
import { requireUserId } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { reconcileLibraryImport } from '#app/utils/library-import-reconciliation.server.ts'
import {
	libraryImportProviders,
	parseLibraryImport,
} from '#app/utils/library-import.ts'
import { type BreadcrumbHandle } from './profile.tsx'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const MAX_IMPORT_ITEMS = 2_000
const ProviderSchema = z.enum(libraryImportProviders)

export const handle: BreadcrumbHandle & SEOHandle = {
	breadcrumb: 'Import library',
	getSitemapEntries: () => null,
}

export async function loader({ request, url }: LoaderFunctionArgs) {
	await requireUserId(request, { url })
	return json({})
}

export async function action({ request, url }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request, { url })
	const contentLength = Number(request.headers.get('content-length') ?? 0)
	if (contentLength > MAX_IMPORT_BYTES + 100_000) {
		return json(
			{ ok: false as const, error: 'The import file must be 5 MB or smaller.' },
			{ status: 413 },
		)
	}
	const formData = await request.formData()
	const provider = ProviderSchema.safeParse(formData.get('provider'))
	const upload = formData.get('library')
	if (!provider.success || !(upload instanceof File) || !upload.size) {
		return json(
			{ ok: false as const, error: 'Choose a provider and export file.' },
			{ status: 400 },
		)
	}
	if (upload.size > MAX_IMPORT_BYTES) {
		return json(
			{ ok: false as const, error: 'The import file must be 5 MB or smaller.' },
			{ status: 413 },
		)
	}
	try {
		const items = parseLibraryImport(provider.data, await upload.text())
		if (!items.length) {
			return json(
				{
					ok: false as const,
					error: 'No supported library entries were found in this export.',
				},
				{ status: 400 },
			)
		}
		if (items.length > MAX_IMPORT_ITEMS) {
			return json(
				{
					ok: false as const,
					error: `This preview contains ${items.length.toLocaleString()} entries. Split it into batches of 2,000 or fewer.`,
				},
				{ status: 400 },
			)
		}
		const resolutions = await reconcileLibraryImport(prisma, ownerId, items)
		const summary = resolutions.reduce(
			(counts, item) => {
				counts[item.match.state] += 1
				if (item.existing) counts.conflicts += 1
				return counts
			},
			{ matched: 0, ambiguous: 0, unmatched: 0, conflicts: 0 },
		)
		return json({
			ok: true as const,
			fileName: upload.name.slice(0, 160),
			provider: provider.data,
			summary,
			resolutions,
		})
	} catch {
		return json(
			{
				ok: false as const,
				error:
					'The export could not be parsed. Confirm the provider and use its original XML, JSON, or CSV file.',
			},
			{ status: 400 },
		)
	}
}

const providerLabels = {
	myanimelist: 'MyAnimeList XML',
	anilist: 'AniList JSON',
	trakt: 'Trakt JSON',
	letterboxd: 'Letterboxd CSV',
} as const

export default function ProfileImportRoute() {
	const result = useActionData<typeof action>()
	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-2xl font-black text-veud-cream">
					Import another library
				</h2>
				<p className="mt-2 text-sm leading-6 text-veud-copy">
					Preview matches and conflicts before Veud changes anything. Export
					files are parsed for this request and are not sent to an AI provider.
				</p>
			</div>
			<Form
				method="post"
				encType="multipart/form-data"
				className="grid gap-4 rounded-2xl border border-veud-border bg-black/10 p-5"
			>
				<label className="grid gap-2 text-sm font-black text-veud-copy">
					Source
					<select
						name="provider"
						required
						className="min-h-11 rounded-xl border border-veud-border bg-veud-canvas px-3 text-veud-cream"
					>
						{libraryImportProviders.map(provider => (
							<option key={provider} value={provider}>
								{providerLabels[provider]}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-2 text-sm font-black text-veud-copy">
					Export file
					<input
						type="file"
						name="library"
						required
						accept=".xml,.json,.csv,text/xml,application/json,text/csv"
						className="min-h-11 rounded-xl border border-veud-border bg-black/20 p-2 text-veud-copy file:mr-3 file:rounded-lg file:border-0 file:bg-veud-mint file:px-3 file:py-2 file:font-black file:text-veud-canvas"
					/>
				</label>
				<Button type="submit">Build conflict preview</Button>
				<p className="text-xs text-veud-copy">
					Maximum 5 MB and 2,000 entries per preview.
				</p>
			</Form>
			{result && !result.ok ? (
				<p
					role="alert"
					className="rounded-xl border border-red-300/40 bg-red-950/30 p-4 text-sm text-red-100"
				>
					{result.error}
				</p>
			) : null}
			{result?.ok ? (
				<section aria-labelledby="import-preview-heading">
					<h2
						id="import-preview-heading"
						className="text-xl font-black text-veud-yellow"
					>
						Preview: {result.fileName}
					</h2>
					<dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
						{Object.entries(result.summary).map(([label, value]) => (
							<div
								key={label}
								className="rounded-xl border border-veud-border bg-black/15 p-3"
							>
								<dt className="text-xs font-black uppercase text-veud-copy">
									{label}
								</dt>
								<dd className="mt-1 text-2xl font-black text-veud-cream">
									{value}
								</dd>
							</div>
						))}
					</dl>
					<ul className="mt-5 grid gap-3">
						{result.resolutions.slice(0, 100).map(item => (
							<li
								key={item.sourceKey}
								className="rounded-xl border border-veud-border bg-black/10 p-4"
							>
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<h3 className="font-black text-veud-cream">{item.title}</h3>
										<p className="text-xs capitalize text-veud-copy">
											{item.mediaKind} · {item.status}
											{item.score === null ? '' : ` · ${item.score}/10`}
										</p>
									</div>
									<span className="rounded-full border border-veud-border px-3 py-1 text-xs font-black capitalize text-veud-mint">
										{item.match.state}
									</span>
								</div>
								{item.match.state === 'matched' ? (
									<p className="mt-2 text-sm text-veud-copy">
										Matched {item.match.title} by{' '}
										{item.match.method.replace('-', ' ')}.
										{item.existing
											? ` Existing Veud status: ${item.existing.status}.`
											: ''}
									</p>
								) : null}
							</li>
						))}
					</ul>
					{result.resolutions.length > 100 ? (
						<p className="mt-4 text-sm text-veud-copy">
							Showing the first 100 of {result.resolutions.length} entries.
						</p>
					) : null}
					<p className="mt-5 rounded-xl border border-dashed border-veud-border p-4 text-sm text-veud-copy">
						This phase is preview-only. Conflict choices and an atomic commit
						step are next; no list entries were changed.
					</p>
				</section>
			) : null}
		</div>
	)
}
