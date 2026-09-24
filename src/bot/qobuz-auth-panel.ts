import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js"
import type {
  CredentialSource,
  CredentialUpdateResult,
  QobuzAuthSnapshot,
} from "../qobuz/client.js"
import type { QobuzCredentialInput, QobuzStatus } from "../qobuz/types.js"

export const QOBUZ_AUTH_IDS = {
  update: "qobuz-auth:update",
  rederive: "qobuz-auth:rederive",
  clear: "qobuz-auth:clear",
  modal: "qobuz-auth:modal",
  tokenField: "token",
  appIdField: "app_id",
  appSecretField: "app_secret",
} as const

export function isQobuzAuthId(customId: string): boolean {
  return customId.startsWith("qobuz-auth:")
}

const STATE_LABEL: Record<QobuzStatus["state"], string> = {
  ready: "Connected",
  not_configured: "Not configured",
  token_invalid: "Token rejected (expired or invalid)",
  secret_invalid: "App secret rejected",
  unreachable: "Qobuz unreachable",
  error: "Error",
}

const SOURCE_LABEL: Record<CredentialSource, string> = {
  saved: "saved via /qobuz-auth",
  session: "set via /qobuz-auth, not saved to disk",
  env: "from .env",
  none: "none",
}

const TOKEN_HELP =
  "To get a token: log in at <https://play.qobuz.com>, open DevTools → Network, play a track, " +
  "and copy the `X-User-Auth-Token` header from an `api.json` request. Then press **Update credentials**."

const STATE_HINT: Partial<Record<QobuzStatus["state"], string>> = {
  not_configured: TOKEN_HELP,
  token_invalid: TOKEN_HELP,
  secret_invalid:
    "Press **Re-derive secret** to pull fresh secrets from the Qobuz web player. If that fails too, " +
    "Qobuz changed its web player: paste a known-good app ID + secret pair with **Update credentials**.",
  unreachable: "The bot retries automatically.",
  error: "The bot retries automatically. **Re-derive secret** or **Update credentials** may also help.",
}

export function formatAuthPanel(snapshot: QobuzAuthSnapshot): string {
  const { status } = snapshot
  const lines = [`**Qobuz:** ${STATE_LABEL[status.state]}`]

  if (snapshot.tokenHint) {
    const when = snapshot.savedAt ? discordTimestamp(snapshot.savedAt) : undefined
    const source = SOURCE_LABEL[snapshot.source] + (when ? ` ${when}` : "")
    lines.push(`Token: \`${snapshot.tokenHint}\` (${source})`)
  }

  if (status.state === "ready") {
    const secret = status.secretSource === "derived" ? "derived from the web player" : "configured"
    lines.push(`App ID: \`${status.appId}\` · secret ${secret}`)
  }

  if ("detail" in status && status.detail) {
    lines.push(`Details: \`${sanitizeDetail(status.detail)}\``)
  }

  const hint = STATE_HINT[status.state]
  if (hint) lines.push("", hint)

  return lines.join("\n")
}

export function buildAuthPanelRows(snapshot: QobuzAuthSnapshot): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(QOBUZ_AUTH_IDS.update)
      .setLabel("Update credentials")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(QOBUZ_AUTH_IDS.rederive)
      .setLabel("Re-derive secret")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!snapshot.tokenHint)
  )

  if (snapshot.source === "saved" || snapshot.source === "session") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(QOBUZ_AUTH_IDS.clear)
        .setLabel("Clear saved (use .env)")
        .setStyle(ButtonStyle.Danger)
    )
  }

  return [row]
}

export function buildCredentialsModal(snapshot: QobuzAuthSnapshot): ModalBuilder {
  const tokenDescription = snapshot.tokenHint
    ? `Leave empty to keep the current token (${snapshot.tokenHint})`
    : "X-User-Auth-Token header from play.qobuz.com"

  return new ModalBuilder()
    .setCustomId(QOBUZ_AUTH_IDS.modal)
    .setTitle("Qobuz credentials")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("User token")
        .setDescription(tokenDescription)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(QOBUZ_AUTH_IDS.tokenField)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000)
        ),
      new LabelBuilder()
        .setLabel("App ID (optional)")
        .setDescription("Leave empty to keep the current one or auto-detect")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(QOBUZ_AUTH_IDS.appIdField)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20)
        ),
      new LabelBuilder()
        .setLabel("App secret (optional)")
        .setDescription("32 hex characters. Leave empty to keep the current one or auto-derive")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(QOBUZ_AUTH_IDS.appSecretField)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(64)
        )
    )
}

export type CredentialFormValues = { token: string; appId: string; appSecret: string }

export type ParsedCredentialForm =
  | { ok: true; input: QobuzCredentialInput }
  | { ok: false; error: string }

export function parseCredentialForm(values: CredentialFormValues): ParsedCredentialForm {
  const token = values.token.trim().replace(/^x-user-auth-token\s*:\s*/i, "")
  const appId = values.appId.trim()
  const appSecret = values.appSecret.trim()

  if (!token && !appId && !appSecret) {
    return { ok: false, error: "Nothing to change: fill in at least one field." }
  }
  if (token && !/^[A-Za-z0-9._~+/=-]{16,1000}$/.test(token)) {
    return {
      ok: false,
      error: "That doesn't look like a Qobuz user token. Paste only the header value, without quotes or spaces.",
    }
  }
  if (appId && !/^\d{6,12}$/.test(appId)) {
    return { ok: false, error: "App ID must be digits only." }
  }
  if (appSecret && !/^[0-9a-f]{32}$/i.test(appSecret)) {
    return { ok: false, error: "App secret must be exactly 32 hex characters." }
  }

  const input: QobuzCredentialInput = {}
  if (token) input.userToken = token
  if (appId) input.appId = appId
  if (appSecret) input.appSecret = appSecret
  return { ok: true, input }
}

export function formatUpdateOutcome(result: CredentialUpdateResult): string {
  if (result.applied) {
    return result.persisted
      ? "Saved. Qobuz is connected."
      : "Qobuz is connected, but the credentials could not be saved to disk and will be lost on restart. Check the bot logs."
  }
  return `Nothing was changed: ${describeFailure(result.status)}.`
}

export function formatRederiveOutcome(result: CredentialUpdateResult): string {
  if (result.applied) {
    return result.persisted
      ? "Found a working secret and saved it. Qobuz is connected."
      : "Found a working secret, but it could not be saved to disk. Check the bot logs."
  }
  return `Re-deriving didn't help: ${describeFailure(result.status)}.`
}

function describeFailure(status: QobuzStatus): string {
  switch (status.state) {
    case "not_configured":
      return "no user token is set"
    case "token_invalid":
      return "Qobuz rejected the token"
    case "secret_invalid":
      return "the token works, but no app secret could sign stream requests"
    case "unreachable":
      return "couldn't reach Qobuz"
    case "error":
      return `Qobuz returned an error (${sanitizeDetail(status.detail)})`
    case "ready":
      return "unexpected state"
  }
}

function sanitizeDetail(detail: string): string {
  const flat = detail.replace(/[`\r\n]+/g, " ").trim()
  return flat.length > 300 ? `${flat.slice(0, 299)}…` : flat
}

function discordTimestamp(iso: string): string | undefined {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  return `<t:${Math.floor(ms / 1000)}:R>`
}
