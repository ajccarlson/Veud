import ReactMarkdown from 'react-markdown'

export function ProfileAbout({ bio }: { bio: string | null }) {
	if (!bio) return null

	return (
		<section className="user-landing-about">
			<h1 className="user-landing-body-header">About</h1>
			<div className="user-landing-about-content">
				<ReactMarkdown
					skipHtml
					components={{
						a: ({ node: _node, children, ...props }) => (
							<a
								{...props}
								target="_blank"
								rel="nofollow noopener noreferrer"
							>
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
