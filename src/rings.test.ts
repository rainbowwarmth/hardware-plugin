/**
 * `rings.ts` 的用例
 *
 * 双色环是本批的核心呈现，而它的两段弧算错**不会报任何错** —— 只表现为「环画得不对」，
 * 而「不对」在一枚 96 像素的环上极难分辨（一道发丝般的缝、或本进程那一段多出半度）。
 * 故断言全落在几何量上，不靠看。
 *
 * 三类断言各有其不可替代之处：
 * - **两段首尾相接**：本进程那一段的长度即整机那一段的起点。错开时环上会出现一道缝或
 *   一处叠色，而那正是「包含关系」这一语义的唯一可见凭据。
 * - **两段之和等于整机**：这是双色环存在的理由 —— 一枚环同时说清两个数。
 * - **本进程夹在整机之内**：两个数来自两个接口两个采样时刻，瞬时矛盾必然发生，
 *   而真机上撞见它得等一次巧合。
 *
 * 本模块无依赖，故本文件不 mock 任何东西。
 */
import { describe, expect, it } from "vitest"
import { RING_CIRCUMFERENCE, RING_RADIUS, RING_VIEWBOX, dualRing, ringLegend } from "./rings.js"

/**
 * 取一段弧画出来的那一截有多长
 * @param dash `stroke-dasharray` 的取值
 * @returns 弧长
 */
function filledOf(dash: string): number {
  return Number(dash.split(" ")[0])
}

/**
 * 取一段弧自路径上何处起画
 * @param offset `stroke-dashoffset` 的取值
 * @returns 起点距 12 点的路径长度
 */
function startOf(offset: string): number {
  return Number((RING_CIRCUMFERENCE - Number(offset)).toFixed(2))
}

describe("几何常量", () => {
  it("**半径与 viewBox 与面板内置的环一致** —— 两处不同会让插件的环比内置的大一圈", () => {
    expect(RING_RADIUS).toBe(42)
    expect(RING_VIEWBOX).toBe(100)
  })

  it("周长由半径算出，不是另写一个数", () => {
    expect(RING_CIRCUMFERENCE).toBeCloseTo(2 * Math.PI * 42, 10)
  })

  it("环装得进 viewBox：直径加线宽不超过边长", () => {
    // 线宽 9（styles.css 里 `.ring-base` / `.ring-fill` 的取值），半径 42 故直径 84
    expect(RING_RADIUS * 2 + 9).toBeLessThanOrEqual(RING_VIEWBOX)
  })
})

describe("dualRing", () => {
  it("**两段首尾相接**：本进程那一段有多长，整机那一段就自那里起画", () => {
    const ring = dualRing(0.5, 0.2)
    expect(startOf(ring.rest.offset)).toBeCloseTo(filledOf(ring.own.dash), 1)
  })

  it("**本进程那一段自 12 点起** —— offset 等于整周长即「不偏移」", () => {
    const ring = dualRing(0.5, 0.2)
    expect(startOf(ring.own.offset)).toBe(0)
  })

  it("**两段之和恰是整机占用** —— 这是双色环存在的理由", () => {
    const ring = dualRing(0.47, 0.03)
    const sum = filledOf(ring.own.dash) + filledOf(ring.rest.dash)
    expect(sum).toBeCloseTo(RING_CIRCUMFERENCE * 0.47, 1)
  })

  it("每一段的两截之和都等于周长 —— 否则 dash 图案会重复，环上多出一道发丝弧", () => {
    const ring = dualRing(0.777, 0.333)
    for (const arc of [ring.own, ring.rest]) {
      const parts = arc.dash.split(" ").map(Number)
      expect(parts[0]! + parts[1]!).toBeCloseTo(RING_CIRCUMFERENCE, 1)
    }
  })

  it("**本进程超过整机时夹到整机** —— 两个接口两个采样时刻，这种瞬时矛盾必然发生", () => {
    const ring = dualRing(0.03, 0.05)
    expect(ring.ownRatio).toBe(0.03)
    // 夹住之后整机那一段为 0，两段之和仍等于整机
    expect(filledOf(ring.rest.dash)).toBe(0)
    expect(filledOf(ring.own.dash)).toBeCloseTo(RING_CIRCUMFERENCE * 0.03, 1)
  })

  it("**整机测不到而本进程有数时，本进程那一段照常画** —— 首次采样正是这种情形", () => {
    const ring = dualRing(undefined, 0.2)
    expect(ring.totalRatio).toBeUndefined()
    expect(ring.ownRatio).toBe(0.2)
    expect(filledOf(ring.own.dash)).toBeCloseTo(RING_CIRCUMFERENCE * 0.2, 1)
  })

  it("两个都测不到时两段皆为 0，且不抛错", () => {
    const ring = dualRing(undefined, undefined)
    expect(ring.ownRatio).toBeUndefined()
    expect(ring.totalRatio).toBeUndefined()
    expect(filledOf(ring.own.dash)).toBe(0)
    expect(filledOf(ring.rest.dash)).toBe(0)
  })

  it("整机有数而本进程测不到时，整机那一段自 12 点起画满 —— 不留一段空白", () => {
    const ring = dualRing(0.6, undefined)
    expect(startOf(ring.rest.offset)).toBe(0)
    expect(filledOf(ring.rest.dash)).toBeCloseTo(RING_CIRCUMFERENCE * 0.6, 1)
  })

  it("满载时整段铺满整圈", () => {
    const ring = dualRing(1, 0.4)
    const sum = filledOf(ring.own.dash) + filledOf(ring.rest.dash)
    expect(sum).toBeCloseTo(RING_CIRCUMFERENCE, 1)
  })

  it("超出 0-1 的输入收进范围，不画出圈外", () => {
    const ring = dualRing(1.5, -0.2)
    expect(ring.totalRatio).toBe(1)
    expect(ring.ownRatio).toBe(0)
    expect(filledOf(ring.rest.dash)).toBeCloseTo(RING_CIRCUMFERENCE, 1)
  })

  it("非有限数按测不到处置，不产出 NaN 的 dasharray", () => {
    const ring = dualRing(Number.NaN, Number.POSITIVE_INFINITY)
    expect(ring.totalRatio).toBeUndefined()
    expect(ring.ownRatio).toBeUndefined()
    expect(ring.own.dash).not.toContain("NaN")
    expect(ring.rest.dash).not.toContain("NaN")
  })

  it("**offset 一律非负** —— 负的 dashoffset 在个别旧浏览器上被当作 0，两段会叠在一处", () => {
    for (const [total, own] of [[0.5, 0.2], [1, 1], [0.03, 0.05], [undefined, 0.9]] as const) {
      const ring = dualRing(total, own)
      expect(Number(ring.own.offset)).toBeGreaterThanOrEqual(0)
      expect(Number(ring.rest.offset)).toBeGreaterThanOrEqual(0)
    }
  })
})

/*
 * 三条图例的断言
 *
 * 图例上那三个百分数是使用者唯一能核对环的凭据，而它们算错同样不报错：一枚
 * 「其他占用 -3%」或一组加起来 97% 的图例，看上去与正确的没有分别。
 */
describe("ringLegend", () => {
  it("三条的顺序是本进程、其他、空闲 —— 与环上自内向外的次序一致", () => {
    const items = ringLegend(0.5, 0.2, "yunzai-ng")
    expect(items.map(item => item.kind)).toEqual(["own", "rest", "idle"])
    expect(items[0]!.label).toBe("yunzai-ng")
  })

  it("**三条加起来恰好是 1** —— 加不满时使用者会以为哪一段没算上", () => {
    const items = ringLegend(0.35, 0.08, "本进程")
    const sum = items.reduce((acc, item) => acc + (item.ratio ?? 0), 0)
    expect(sum).toBeCloseTo(1, 10)
  })

  it("「其他」是整机减本进程，不是另采的一个数", () => {
    const items = ringLegend(0.4, 0.1, "本进程")
    expect(items[1]!.ratio).toBeCloseTo(0.3, 10)
  })

  it("空闲是 1 减整机 —— 与本进程占多少无关", () => {
    expect(ringLegend(0.4, 0.1, "本进程")[2]!.ratio).toBeCloseTo(0.6, 10)
    expect(ringLegend(0.4, 0.35, "本进程")[2]!.ratio).toBeCloseTo(0.6, 10)
  })

  it("**整机测不到时「其他」与「空闲」都给 undefined** —— 一条「其他 0%」会被读成「只有机器人在跑」", () => {
    const items = ringLegend(undefined, 0.2, "本进程")
    expect(items[0]!.ratio).toBe(0.2)
    expect(items[1]!.ratio).toBeUndefined()
    expect(items[2]!.ratio).toBeUndefined()
  })

  it("本进程超过整机时按夹紧后的值算，故「其他」不会是负数", () => {
    const items = ringLegend(0.03, 0.05, "本进程")
    expect(items[0]!.ratio).toBe(0.03)
    expect(items[1]!.ratio).toBe(0)
    expect(items[2]!.ratio).toBeCloseTo(0.97, 10)
  })

  it("本进程测不到而整机有数时，「其他」即整机 —— 那时无从分辨谁占的", () => {
    const items = ringLegend(0.6, undefined, "本进程")
    expect(items[0]!.ratio).toBeUndefined()
    expect(items[1]!.ratio).toBeCloseTo(0.6, 10)
    expect(items[2]!.ratio).toBeCloseTo(0.4, 10)
  })

  it("满载时空闲为 0 —— 这一条是真的 0，不是测不到", () => {
    const items = ringLegend(1, 0.4, "本进程")
    expect(items[2]!.ratio).toBe(0)
  })
})
