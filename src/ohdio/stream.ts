import { APP_CODE, USER_AGENT, VALIDATION_URL } from "./constants.js"
import { OhdioError } from "./errors.js"
import { assertAllowedOhdioStreamUrl, normalizeOhdioStreamUrl } from "./stream-url.js"
import type { StreamInfo } from "../player/stream.js"

type ValidationResponse = {
  errorCode?: number
  message?: string
  url?: string
  params?: Array<{ name?: string; value?: string }>
}

export async function validateMedia(
  mediaId: string,
  appCode: string = APP_CODE.catchup
): Promise<StreamInfo> {
  const url = new URL(VALIDATION_URL)
  url.searchParams.set("appCode", appCode)
  url.searchParams.set("connectionType", "hd")
  url.searchParams.set("deviceType", "ipad")
  url.searchParams.set("idMedia", mediaId)
  url.searchParams.set("multibitrate", "true")
  url.searchParams.set("output", "json")
  url.searchParams.set("tech", "hls")

  let res: Response
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    })
  } catch {
    throw new OhdioError("Network error fetching Ohdio stream", { kind: "network" })
  }

  let json: ValidationResponse
  try {
    json = (await res.json()) as ValidationResponse
  } catch {
    throw new OhdioError("Ohdio returned an invalid stream response")
  }

  if (!res.ok || json.errorCode || !json.url) {
    throw new OhdioError(json.message || "Failed to resolve Ohdio stream")
  }

  const streamUrl = normalizeOhdioStreamUrl(json.url)
  assertAllowedOhdioStreamUrl(streamUrl)
  return { url: streamUrl, userAgent: USER_AGENT }
}
