import ReactMarkdown from 'react-markdown'
import { ProfileEmptyState } from '#app/components/profile-ui.tsx'

export function ProfileAbout({ bio }: { bio: string | null }) {
	if (!bio) {
		return (
			<ProfileEmptyState
				icon="person"
				title="No introduction yet"
				description="This member has not added anything to their profile bio."
			/>
		)
	}

	return (
		<section className="user-landing-about">
			<header className="user-landing-section-heading">
				<span>Profile</span>
				<h2>About</h2>
			</header>
			<div className="user-landing-about-content">
				<ReactMarkdown
					skipHtml
					components={{
						a: ({ node: _node, children, ...props }) => (
							<a {...props} target="_blank" rel="nofollow noopener noreferrer">
								{children}
							</a>
						),
						img: ({ node: _node, ...props }) => (
							<img {...props} loading="lazy" referrerPolicy="no-referrer" />
						),
					}}
				>
					{bio}
				</ReactMarkdown>
			</div>
		</section>
	)
}
