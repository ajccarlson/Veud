import { type ActionFunctionArgs } from 'react-router'
import { requireUserId } from '#app/utils/auth.server.ts'
import { deleteEntryCommand } from './delete-row.$request.ts'

export async function action({ request, params }: ActionFunctionArgs) {
	const ownerId = await requireUserId(request)
	const searchParams = new URLSearchParams(params.request)
	return deleteEntryCommand(ownerId, searchParams.get('id'))
}
