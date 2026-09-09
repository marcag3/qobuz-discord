export class OhdioError extends Error {
  readonly kind: "not_found" | "network" | "unknown"

  constructor(message: string, options?: { kind?: "not_found" | "network" | "unknown" }) {
    super(message)
    this.name = "OhdioError"
    this.kind = options?.kind ?? "unknown"
  }

  static notFound(message = "Ohdio item not found"): OhdioError {
    return new OhdioError(message, { kind: "not_found" })
  }
}
