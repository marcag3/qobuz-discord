import { describe, expect, it } from "vitest"
import { parseMostPopular, unwrapPopularItem } from "../../src/qobuz/search.js"
import lane8 from "../fixtures/search-lane-8.json"
import lane8Title from "../fixtures/search-lane8-title.json"

describe("unwrapPopularItem", () => {
  it("unwraps wrapped most_popular items", () => {
    const item = lane8Title.most_popular.items[0]
    expect(unwrapPopularItem(item)).toEqual({
      type: "tracks",
      id: 424950499,
      title: "And We Knew It Was Our Time",
      artistName: "Lane 8",
    })
  })
})

describe("parseMostPopular", () => {
  it("returns artist Lane 8 first for lane 8 query fixture", () => {
    const items = parseMostPopular(lane8.most_popular.items)
    expect(items[0]).toMatchObject({ type: "artists", title: "Lane 8" })
  })

  it("returns target track first for title query fixture", () => {
    const items = parseMostPopular(lane8Title.most_popular.items)
    expect(items[0]).toMatchObject({
      type: "tracks",
      id: 424950499,
      title: "And We Knew It Was Our Time",
    })
  })
})
