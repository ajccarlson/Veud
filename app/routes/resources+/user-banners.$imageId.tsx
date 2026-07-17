import { invariantResponse } from '@epic-web/invariant'
import { type LoaderFunctionArgs } from '@remix-run/node'
import { prisma } from '#app/utils/db.server.ts'

export async function loader({ params }: LoaderFunctionArgs) {
	invariantResponse(params.imageId, 'Banner ID is required', { status: 400 })
	const banner = await prisma.userBanner.findUnique({
		where: { id: params.imageId },
		select: { contentType: true, blob: true },
	})

	invariantResponse(banner, 'Not found', { status: 404 })

	// banner.blob is Prisma Bytes — a Buffer at runtime, which Response accepts. The cast
	// satisfies the DOM BodyInit type that @types/node's Buffer no longer matches.
	return new Response(banner.blob as unknown as BodyInit, {
		headers: {
			'Content-Type': banner.contentType,
			'Content-Length': Buffer.byteLength(banner.blob).toString(),
			'Content-Disposition': `inline; filename="${params.imageId}"`,
			'Cache-Control': 'public, max-age=31536000, immutable',
		},
	})
}
