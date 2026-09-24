import { Team, TeamMemberRole, type Client } from "discord.js"

export type OwnerResolver = {
  getOwnerIds(): Promise<string[]>
  isOwner(userId: string): Promise<boolean>
}

export function createOwnerResolver(client: Client, configuredIds: string[]): OwnerResolver {
  let cached: Promise<string[]> | null = null

  const load = async (): Promise<string[]> => {
    if (configuredIds.length > 0) return configuredIds
    if (!client.application) return []

    const app = await client.application.fetch()
    const owner = app.owner
    if (!owner) return []
    if (owner instanceof Team) {
      return owner.members
        .filter((member) => member.role !== TeamMemberRole.ReadOnly)
        .map((member) => member.id)
    }
    return [owner.id]
  }

  const getOwnerIds = (): Promise<string[]> => {
    cached ??= load().catch((err) => {
      cached = null
      throw err
    })
    return cached
  }

  return {
    getOwnerIds,
    async isOwner(userId) {
      try {
        return (await getOwnerIds()).includes(userId)
      } catch (err) {
        console.error("Could not resolve bot owner:", (err as Error).message)
        return false
      }
    },
  }
}
