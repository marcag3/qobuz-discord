import { describe, expect, it } from "vitest"
import { buildSearchSelectOptions, parseSearchSelection } from "../../src/bot/search-menu.js"
import type { PopularItem } from "../../src/qobuz/types.js"

describe("buildSearchSelectOptions", () => {
  it("labels items by type and truncates long titles", () => {
    const items: PopularItem[] = [
      { type: "tracks", id: 1, title: "Creep", artistName: "Radiohead" },
      { type: "albums", id: 2, title: "OK Computer", artistName: "Radiohead" },
    ]

    const options = buildSearchSelectOptions(items)
    expect(options).toHaveLength(2)
    expect(options[0].label).toBe("Track: Creep")
    expect(options[1].label).toBe("Album: OK Computer")
  })

  it("caps options at 25", () => {
    const items: PopularItem[] = Array.from({ length: 30 }, (_, i) => ({
      type: "tracks",
      id: i,
      title: `Track ${i}`,
    }))
    expect(buildSearchSelectOptions(items)).toHaveLength(25)
  })
})

describe("parseSearchSelection", () => {
  const items: PopularItem[] = [
    { type: "tracks", id: 424950499, title: "And We Knew It Was Our Time", artistName: "Lane 8" },
  ]

  it("finds selected item by type and id", () => {
    const selected = parseSearchSelection("tracks:424950499:0", items)
    expect(selected?.title).toBe("And We Knew It Was Our Time")
  })
})
