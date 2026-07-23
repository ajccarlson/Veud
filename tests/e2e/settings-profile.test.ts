import { invariant } from '@epic-web/invariant'
import { faker } from '@faker-js/faker'
import { verifyUserPassword } from '#app/utils/auth.server.ts'
import { prisma } from '#app/utils/db.server.ts'
import { readEmail } from '#tests/mocks/utils.ts'
import { expect, test, createUser, waitFor } from '#tests/playwright-utils.ts'

const CODE_REGEX = /Here's your verification code: (?<code>[\d\w]+)/

test('Users can update their basic info', async ({ page, login }) => {
	const user = await login()
	await page.goto('/settings/profile')

	const newUserData = createUser()
	const bio = '## About me\n\nI track **anime**, manga, and films.'

	await page
		.getByRole('textbox', { name: /^username/i })
		.fill(newUserData.username)
	await page.getByRole('textbox', { name: /about/i }).fill(bio)

	await page.getByRole('button', { name: /^save/i }).click()

	await expect
		.poll(async () =>
			prisma.user.findUnique({
				where: { id: user.id },
				select: { username: true, bio: true },
			}),
		)
		.toEqual({ username: newUserData.username, bio })
})

test('Users can update their password', async ({ page, login }) => {
	const oldPassword = `Aa1!${faker.string.alphanumeric(16)}`
	const newPassword = `Aa1!${faker.string.alphanumeric(16)}`
	const user = await login({ password: oldPassword })
	await page.goto('/settings/profile')

	await page.getByRole('link', { name: /change password/i }).click()
	await expect(page).toHaveURL('/settings/profile/password')
	const passwordForm = page.locator('#password-change-form')
	await expect(passwordForm).toBeVisible()

	await passwordForm.getByLabel(/^current password/i).fill(oldPassword)
	await passwordForm.getByLabel(/^new password/i).fill(newPassword)
	await passwordForm.getByLabel(/^confirm new password/i).fill(newPassword)

	await passwordForm
		.getByRole('button', { name: /^change password/i })
		.click()

	await expect(page).toHaveURL(`/settings/profile`)

	const { username } = user
	expect(
		await verifyUserPassword({ username }, oldPassword),
		'Old password still works',
	).toEqual(null)
	expect(
		await verifyUserPassword({ username }, newPassword),
		'New password does not work',
	).toEqual({ id: user.id })
})

test('Users can update their profile photo', async ({ page, login }) => {
	const user = await login()
	await page.goto('/settings/profile')

	const beforeSrc = await page
		.getByRole('img', { name: user.username }).last()
		.getAttribute('src')

	await page.getByRole('link', { name: /change profile photo/i }).click()

	await expect(page).toHaveURL(`/settings/profile/photo`)

	await page
		.getByLabel(/^change$/i)
		.setInputFiles('./tests/fixtures/images/user/kody.png')

	await page.getByRole('button', { name: /save/i }).click()

	await expect(
		page,
		'Was not redirected after saving the profile photo',
	).toHaveURL(`/settings/profile`)

	const afterSrc = await page
		.getByRole('img', { name: user.username }).last()
		.getAttribute('src')

	expect(beforeSrc).not.toEqual(afterSrc)
})

test('Users can change their email address', async ({ page, login }) => {
	const currentPassword = `Aa1!${faker.string.alphanumeric(16)}`
	const preUpdateUser = await login({ password: currentPassword })
	const newEmailAddress = faker.internet.email().toLowerCase()
	expect(preUpdateUser.email).not.toEqual(newEmailAddress)
	await page.goto('/settings/profile')
	await page.getByRole('link', { name: /change email/i }).click()
	await page.getByRole('textbox', { name: /new email/i }).fill(newEmailAddress)
	await page
		.getByRole('textbox', { name: /current password/i })
		.fill(currentPassword)
	await page.getByRole('button', { name: /send confirmation/i }).click()
	await expect(page.getByText(/check your email/i)).toBeVisible()
	const email = await waitFor(() => readEmail(newEmailAddress), {
		errorMessage: 'Confirmation email was not sent',
	})
	invariant(email, 'Email was not sent')
	const codeMatch = email.text.match(CODE_REGEX)
	const code = codeMatch?.groups?.code
	invariant(code, 'Onboarding code not found')
	await page.getByRole('textbox', { name: /code/i }).fill(code)
	await page.getByRole('button', { name: /submit/i }).click()
	await expect(page.getByText(/email changed/i)).toBeVisible()

	const updatedUser = await prisma.user.findUnique({
		where: { id: preUpdateUser.id },
		select: { email: true },
	})
	invariant(updatedUser, 'Updated user not found')
	expect(updatedUser.email).toBe(newEmailAddress)
	const noticeEmail = await waitFor(() => readEmail(preUpdateUser.email), {
		errorMessage: 'Notice email was not sent',
	})
	expect(noticeEmail.subject).toContain('changed')
})

test('Users can permanently delete their account', async ({ page, login }) => {
	const currentPassword = `Aa1!${faker.string.alphanumeric(16)}`
	const user = await login({ password: currentPassword })
	await page.goto('/settings/profile')

	await page
		.getByRole('textbox', { name: new RegExp(`type ${user.username}`, 'i') })
		.fill(user.username)
	await page
		.getByRole('textbox', { name: /current password/i })
		.fill(currentPassword)
	await page
		.getByRole('button', { name: /permanently delete account/i })
		.click()

	await expect(page).toHaveURL('/')
	await expect(page.getByText(/your veud account.*deleted/i)).toBeVisible()
	expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull()
})
