import { GRAPHQL_URL, OHDIO_ORIGIN, USER_AGENT } from "./constants.js"
import { OhdioError } from "./errors.js"

export async function graphql<T>(
  operationName: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: OHDIO_ORIGIN,
        Referer: `${OHDIO_ORIGIN}/`,
        "x-apollo-operation-name": operationName,
      },
      body: JSON.stringify({ query, variables, operationName }),
    })
  } catch {
    throw new OhdioError("Network error talking to Ohdio", { kind: "network" })
  }

  let json: { data?: T; errors?: Array<{ message?: string }> }
  try {
    json = (await res.json()) as typeof json
  } catch {
    throw new OhdioError("Ohdio returned an invalid response")
  }

  if (!res.ok || json.errors?.length) {
    const msg = json.errors?.map((e) => e.message).filter(Boolean).join("; ")
    throw new OhdioError(msg || `Ohdio GraphQL ${operationName} failed`)
  }

  if (!json.data) {
    throw new OhdioError(`Ohdio GraphQL ${operationName} returned no data`)
  }

  return json.data
}

export function isGraphqlError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as { __typename?: string; message?: string }
  if (record.message && typeof record.__typename === "string" && /Error$/i.test(record.__typename)) {
    return true
  }
  return false
}
