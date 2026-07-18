import { invariantResponse } from '@epic-web/invariant'
import { useState, type FormEvent } from 'react'
import {
	data as json,
	type LoaderFunctionArgs,
	Link,
	useLoaderData,
	useLocation,
	useOutletContext,
	useRevalidator,
} from 'react-router'
import { Button } from '#app/components/ui/button.tsx'
import { Icon } from '#app/components/ui/icon.tsx'
import { Textarea } from '#app/components/ui/textarea.tsx'
import { prisma } from '#app/utils/db.server.ts'
import { getUserImgSrc, useDoubleCheck } from '#app/utils/misc.tsx'
import {
	PROFILE_COMMENT_MAX_LENGTH,
	type ProfileCommentItem,
	type ProfileData,
} from '#app/utils/profile.ts'
import { useOptionalUser } from '#app/utils/user.ts'

const PROFILE_COMMENT_PAGE_SIZE = 50

function formatCommentDate(date: Date) {
	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(date)
}

export async function loader({ params }: LoaderFunctionArgs) {
	const profile = await prisma.user.findUnique({
		where: { username: params['username'] },
		select: { id: true },
	})

	invariantResponse(profile, 'User not found', { status: 404 })

	const comments = (
		await prisma.profileComment.findMany({
			where: { profileId: profile.id },
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: PROFILE_COMMENT_PAGE_SIZE,
			select: {
				id: true,
				body: true,
				createdAt: true,
				author: {
					select: {
						id: true,
						name: true,
						username: true,
						image: { select: { id: true } },
					},
				},
			},
		})
	).map(comment => ({
		...comment,
		createdAtDisplay: formatCommentDate(comment.createdAt),
	})) satisfies ProfileCommentItem[]

	return json({ comments })
}

function getProfileCommentUrl(params: Record<string, string>) {
	return (
		'/resources/profile-comment/' +
		encodeURIComponent(new URLSearchParams(params).toString())
	)
}

async function getMutationError(response: Response) {
	const message = await response.text()
	return message || 'The comment could not be updated. Please try again.'
}

function CommentRow({
	comment,
	profileUserId,
	currentUserId,
	isDeleting,
	onDelete,
}: {
	comment: ProfileCommentItem
	profileUserId: string
	currentUserId?: string
	isDeleting: boolean
	onDelete: (commentId: string) => Promise<void>
}) {
	const deleteCheck = useDoubleCheck()
	const canDelete =
		currentUserId === comment.author.id || currentUserId === profileUserId

	return (
		<article className="user-landing-social-comment">
			<Link to={`/users/${comment.author.username}`} prefetch="intent">
				<img
					src={getUserImgSrc(comment.author.image?.id)}
					alt=""
					className="user-landing-social-avatar"
				/>
			</Link>
			<div className="user-landing-social-comment-body">
				<div className="user-landing-social-comment-header">
					<div className="user-landing-social-comment-meta">
						<Link
							to={`/users/${comment.author.username}`}
							prefetch="intent"
							className="user-landing-social-author"
						>
							{comment.author.name ?? comment.author.username}
						</Link>
						<span>@{comment.author.username}</span>
						<time dateTime={new Date(comment.createdAt).toISOString()}>
							{comment.createdAtDisplay}
						</time>
					</div>
					{canDelete ? (
						<Button
							{...deleteCheck.getButtonProps({
								type: 'button',
								onClick: event => {
									if (!event.defaultPrevented) void onDelete(comment.id)
								},
							})}
							variant={deleteCheck.doubleCheck ? 'destructive' : 'ghost'}
							size="sm"
							disabled={isDeleting}
							aria-label={
								deleteCheck.doubleCheck
									? 'Confirm deleting this comment'
									: 'Delete this comment'
							}
							className="user-landing-social-delete"
						>
							<Icon name="trash" aria-hidden="true" />
							{isDeleting
								? 'Deleting…'
								: deleteCheck.doubleCheck
									? 'Confirm'
									: 'Delete'}
						</Button>
					) : null}
				</div>
				<p className="user-landing-social-comment-text">{comment.body}</p>
			</div>
		</article>
	)
}

export default function ProfileSocial() {
	const { comments } = useLoaderData<typeof loader>()
	const profileData = useOutletContext<ProfileData>()
	const currentUser = useOptionalUser()
	const location = useLocation()
	const revalidator = useRevalidator()
	const [body, setBody] = useState('')
	const [isPosting, setIsPosting] = useState(false)
	const [deletingCommentId, setDeletingCommentId] = useState<string | null>(
		null,
	)
	const [mutationError, setMutationError] = useState<string | null>(null)
	const trimmedBody = body.trim()

	async function submitComment(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!trimmedBody || isPosting) return

		setIsPosting(true)
		setMutationError(null)
		try {
			const response = await fetch(
				getProfileCommentUrl({
					intent: 'create',
					profileId: profileData.user.id,
					body: trimmedBody,
				}),
				{ method: 'POST' },
			)
			if (!response.ok) throw new Error(await getMutationError(response))

			setBody('')
			revalidator.revalidate()
		} catch (error) {
			setMutationError(
				error instanceof Error
					? error.message
					: 'The comment could not be posted.',
			)
		} finally {
			setIsPosting(false)
		}
	}

	async function deleteComment(commentId: string) {
		if (deletingCommentId) return

		setDeletingCommentId(commentId)
		setMutationError(null)
		try {
			const response = await fetch(
				getProfileCommentUrl({ intent: 'delete', commentId }),
				{ method: 'POST' },
			)
			if (!response.ok) throw new Error(await getMutationError(response))

			revalidator.revalidate()
		} catch (error) {
			setMutationError(
				error instanceof Error
					? error.message
					: 'The comment could not be deleted.',
			)
		} finally {
			setDeletingCommentId(null)
		}
	}

	const loginUrl = `/login?${new URLSearchParams({
		redirectTo: `${location.pathname}${location.search}`,
	}).toString()}`

	return (
		<section className="user-landing-social">
			<header className="user-landing-social-heading">
				<div>
					<h1>Guestbook</h1>
					<p>
						Leave a message for{' '}
						{profileData.user.name ?? profileData.user.username}.
					</p>
				</div>
				<span>
					{comments.length} {comments.length === 1 ? 'comment' : 'comments'}
				</span>
			</header>

			{currentUser ? (
				<form className="user-landing-social-composer" onSubmit={submitComment}>
					<label htmlFor="profile-comment-body">Leave a comment</label>
					<Textarea
						id="profile-comment-body"
						name="body"
						value={body}
						onChange={event => setBody(event.target.value)}
						maxLength={PROFILE_COMMENT_MAX_LENGTH}
						placeholder="Write a message…"
						required
					/>
					<div className="user-landing-social-composer-footer">
						<span aria-live="polite">
							{body.length}/{PROFILE_COMMENT_MAX_LENGTH}
						</span>
						<Button type="submit" disabled={!trimmedBody || isPosting}>
							<Icon name="paper-plane" aria-hidden="true" />
							{isPosting ? 'Posting…' : 'Post comment'}
						</Button>
					</div>
				</form>
			) : (
				<div className="user-landing-social-sign-in">
					<Link to={loginUrl}>Sign in</Link> to leave a comment.
				</div>
			)}

			{mutationError ? (
				<p className="user-landing-social-error" role="alert">
					{mutationError}
				</p>
			) : null}

			<div className="user-landing-social-comments">
				{comments.length ? (
					comments.map(comment => (
						<CommentRow
							key={comment.id}
							comment={comment}
							profileUserId={profileData.user.id}
							currentUserId={currentUser?.id}
							isDeleting={deletingCommentId === comment.id}
							onDelete={deleteComment}
						/>
					))
				) : (
					<p className="user-landing-empty-message">
						No comments yet. Be the first to leave one.
					</p>
				)}
			</div>
		</section>
	)
}
