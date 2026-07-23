import { invariantResponse } from '@epic-web/invariant'
import { type LoaderFunctionArgs } from 'react-router'
import { prisma } from '#app/utils/db.server.ts'
import { isSafeImageContentType } from '#app/utils/safe-image.ts'

export async function loader({ params }: LoaderFunctionArgs) {
	invariantResponse(params.imageId, 'Image ID is required', { status: 400 })
	const image = await prisma.userImage.findUnique({
		where: { id: params.imageId },
		select: { contentType: true, blob: true },
	})

	invariantResponse(image, 'Not found', { status: 404 })
	invariantResponse(isSafeImageContentType(image.contentType), 'Not found', {
		status: 404,
	})

	// image.blob is Prisma Bytes — a Buffer at runtime, which Response accepts. The cast
	// satisfies the DOM BodyInit type that @types/node's Buffer no longer matches.
	return new Response(image.blob as unknown as BodyInit, {
		headers: {
			'Content-Type': image.contentType,
			'Content-Length': Buffer.byteLength(image.blob).toString(),
			'Content-Disposition': `inline; filename="${params.imageId}"`,
			'Cache-Control': 'public, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff',
		},
	})
}
