import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js"
import type { QobuzService } from "../../qobuz/client.js"
import type { OwnerResolver } from "../owner.js"
import {
  QOBUZ_AUTH_IDS,
  buildAuthPanelRows,
  buildCredentialsModal,
  formatAuthPanel,
  formatRederiveOutcome,
  formatUpdateOutcome,
  parseCredentialForm,
} from "../qobuz-auth-panel.js"

export type QobuzAuthContext = {
  qobuz: QobuzService
  owners: OwnerResolver
}

const NOT_OWNER = "Only the bot owner can manage Qobuz credentials."

type AuthInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction

async function ensureOwner(interaction: AuthInteraction, owners: OwnerResolver): Promise<boolean> {
  if (await owners.isOwner(interaction.user.id)) return true
  await interaction.reply({ content: NOT_OWNER, flags: MessageFlags.Ephemeral })
  return false
}

export function qobuzAuthPanelMessage(qobuz: QobuzService, note?: string) {
  const snapshot = qobuz.snapshot()
  const panel = formatAuthPanel(snapshot)
  return {
    content: note ? `${note}\n\n${panel}` : panel,
    components: buildAuthPanelRows(snapshot),
  }
}

export async function handleQobuzAuthCommand(
  interaction: ChatInputCommandInteraction,
  ctx: QobuzAuthContext
): Promise<void> {
  if (!(await ensureOwner(interaction, ctx.owners))) return
  await interaction.reply({ ...qobuzAuthPanelMessage(ctx.qobuz), flags: MessageFlags.Ephemeral })
}

export async function handleQobuzAuthButton(
  interaction: ButtonInteraction,
  ctx: QobuzAuthContext
): Promise<void> {
  if (!(await ensureOwner(interaction, ctx.owners))) return

  switch (interaction.customId) {
    case QOBUZ_AUTH_IDS.update:
      await interaction.showModal(buildCredentialsModal(ctx.qobuz.snapshot()))
      return
    case QOBUZ_AUTH_IDS.rederive: {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      const result = await ctx.qobuz.rederiveSecret()
      await interaction.editReply(qobuzAuthPanelMessage(ctx.qobuz, formatRederiveOutcome(result)))
      return
    }
    case QOBUZ_AUTH_IDS.clear: {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      await ctx.qobuz.clearSavedCredentials()
      await interaction.editReply(
        qobuzAuthPanelMessage(ctx.qobuz, "Saved credentials cleared. Now using `.env`.")
      )
      return
    }
  }
}

export async function handleQobuzAuthModal(
  interaction: ModalSubmitInteraction,
  ctx: QobuzAuthContext
): Promise<void> {
  if (interaction.customId !== QOBUZ_AUTH_IDS.modal) return
  if (!(await ensureOwner(interaction, ctx.owners))) return

  const parsed = parseCredentialForm({
    token: interaction.fields.getTextInputValue(QOBUZ_AUTH_IDS.tokenField),
    appId: interaction.fields.getTextInputValue(QOBUZ_AUTH_IDS.appIdField),
    appSecret: interaction.fields.getTextInputValue(QOBUZ_AUTH_IDS.appSecretField),
  })
  if (!parsed.ok) {
    await interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral })
    return
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const result = await ctx.qobuz.updateCredentials(parsed.input)
  await interaction.editReply(qobuzAuthPanelMessage(ctx.qobuz, formatUpdateOutcome(result)))
}
