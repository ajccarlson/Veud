import { NEW_PASSWORD_REQUIREMENTS } from '#app/utils/user-validation.ts'

export function PasswordRequirements() {
	return (
		<div
			role="note"
			aria-label="Password requirements"
			className="-mt-3 mb-5 rounded-xl border border-veud-border/70 bg-background/30 px-4 py-3"
		>
			<p className="text-body-xs font-semibold text-foreground">
				Password requirements
			</p>
			<ul className="mt-2 grid gap-x-5 gap-y-1 text-body-xs text-muted-foreground sm:grid-cols-2">
				{NEW_PASSWORD_REQUIREMENTS.map(requirement => (
					<li key={requirement} className="flex items-center gap-2">
						<span
							aria-hidden="true"
							className="h-1.5 w-1.5 shrink-0 rounded-full bg-veud-mint"
						/>
						{requirement}
					</li>
				))}
			</ul>
		</div>
	)
}
