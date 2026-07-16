// Single-instance stub replacing the former `litefs-js` re-exports. The app no longer runs on
// Fly/LiteFS — it's served through a Cloudflare Tunnel under PM2 on one machine — so there is
// only ever a single instance and it is always the primary. These keep the shape the former
// callers (and the admin cache dashboards) expect, without pulling in `litefs-js`.
const INSTANCE = process.env.FLY_MACHINE_ID ?? 'local'

type InstanceInfo = {
	currentInstance: string
	currentIsPrimary: boolean
	primaryInstance: string
}

const instanceInfo: InstanceInfo = {
	currentInstance: INSTANCE,
	currentIsPrimary: true,
	primaryInstance: INSTANCE,
}

export function getInstanceInfoSync(): InstanceInfo {
	return instanceInfo
}

export async function getInstanceInfo(): Promise<InstanceInfo> {
	return instanceInfo
}

export async function getAllInstances(): Promise<Record<string, string>> {
	return { [INSTANCE]: 'local' }
}

export function getInternalInstanceDomain(_instance: string): string {
	// No internal instance networking off Fly.
	return ''
}

export async function ensurePrimary(): Promise<void> {
	// Always primary on a single instance — nothing to do.
}

export async function ensureInstance(_instance?: string): Promise<void> {
	// Single instance — nothing to route to.
}
