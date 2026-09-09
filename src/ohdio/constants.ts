export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export const GRAPHQL_URL = "https://services.radio-canada.ca/bff/audio/graphql"
export const VALIDATION_URL = "https://services.radio-canada.ca/media/validation/v2/"

export const DEFAULT_REGION_ID = 8

export const CONTENT_TYPE = {
  episode: 18,
  programme: 24,
  clip: 26,
  audiobook: 60,
} as const

export const APP_CODE = {
  catchup: "medianet",
  live: "medianetlive",
} as const

export const OHDIO_ORIGIN = "https://ici.radio-canada.ca"

export const MAX_OHDIO_TRACKS = 100
export const PROGRAMME_EPISODE_PAGE_SIZE = 8
