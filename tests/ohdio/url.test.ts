import { describe, expect, it } from "vitest"
import {
  formatOhdioToken,
  isOhdioInput,
  matchLiveAlias,
  parseOhdioInput,
  parseOhdioPath,
  parseOhdioToken,
} from "../../src/ohdio/url.js"

describe("parseOhdioInput", () => {
  it("parses episode URLs", () => {
    expect(
      parseOhdioInput(
        "https://ici.radio-canada.ca/ohdio/premiere/emissions/penelope/episodes/1091696/mercredi-3-juin-2026"
      )
    ).toEqual({ kind: "episode", id: "1091696" })
  })

  it("parses show URLs by slug and by id", () => {
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/premiere/emissions/penelope")).toEqual({
      kind: "programme",
      id: "penelope",
    })
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/premiere/emissions/6896/penelope")).toEqual({
      kind: "programme",
      id: "6896",
    })
  })

  it("parses podcast and episode balado URLs", () => {
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/balados/12879/moteur-en-herbe")).toEqual({
      kind: "programme",
      id: "12879",
    })
    expect(
      parseOhdioInput(
        "https://ici.radio-canada.ca/ohdio/balados/12879/moteur-en-herbe/1271439/episode-complet"
      )
    ).toEqual({ kind: "episode", id: "1271439" })
  })

  it("parses segments, audiobooks, and live network URLs", () => {
    expect(
      parseOhdioPath("/premiere/emissions/penelope/segments/rattrapage/2471585/sommaire")
    ).toEqual({ kind: "clip", id: "2471585" })
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/livres-audio/105993/boires")).toEqual({
      kind: "audiobook",
      id: "105993",
    })
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/premiere")).toEqual({
      kind: "live",
      id: "premiere",
    })
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/musique")).toEqual({
      kind: "live",
      id: "musique",
    })
    expect(parseOhdioInput("https://ici.radio-canada.ca/ohdio/musique/listes-d-ecoute/12345")).toEqual({
      kind: "playlist",
      id: "12345",
    })
  })

  it("parses compact tokens and live aliases", () => {
    expect(parseOhdioToken("ohdio:episode:1091696")).toEqual({ kind: "episode", id: "1091696" })
    expect(formatOhdioToken("programme", "6896")).toBe("ohdio:programme:6896")
    expect(matchLiveAlias("ICI Première")).toBe("premiere")
    expect(parseOhdioInput("ici musique")).toEqual({ kind: "live", id: "musique" })
    expect(isOhdioInput("bohemian rhapsody")).toBe(false)
  })
})
