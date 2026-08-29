/**
 * `disks.ts` 的用例
 *
 * 断言集中在**真机上跑不出来的那些情形**：同一设备挂在多处（要一台特定的 Linux）、
 * 累计量倒退（要重启一次磁盘计数器）、两次采样落在同一毫秒（要跑得比时钟快）。
 * 分区占用本身在真机上一读就有，不值得为它立断言 —— 它错了立刻就看得见。
 *
 * `si.fsSize()` / `si.fsStats()` 一概 mock：两者各要几十到几百毫秒，且返回值随机器而变。
 */
import { afterEach, describe, expect, it, vi } from "vitest"

const siFsSize = vi.fn<() => Promise<unknown>>()
const siFsStats = vi.fn<() => Promise<unknown>>()

vi.mock("systeminformation", () => ({
  default: {
    fsSize: (): Promise<unknown> => siFsSize(),
    fsStats: (): Promise<unknown> => siFsStats()
  }
}))

const { DiskSampler, ioRates, toIoCounters, toPartitions } = await import("./disks.js")

/*
 * 还原 mock 与被 spy 的 `Date.now`
 *
 * 下面有一条用例把 `Date.now` 固定住了。不还原的话，它之后的每一条用例都活在那个
 * 停住的时刻里 —— 而那些用例并不提 Date.now，故失败时无从看出与它有关。
 */
afterEach(() => {
  vi.restoreAllMocks()
})

describe("toPartitions", () => {
  it("取挂载点、类型与三个容量", () => {
    expect(
      toPartitions([{ mount: "C:\\", type: "NTFS", size: 200, used: 120, available: 80 }])
    ).toEqual([{ mount: "C:\\", type: "NTFS", total: 200, used: 120, free: 80 }])
  })

  it("**总量为 0 的条目排掉** —— Linux 上的 squashfs 与 tmpfs 一片都是这种", () => {
    expect(toPartitions([{ mount: "/snap/core", size: 0 }])).toEqual([])
  })

  it("**同一挂载点只留第一条** —— bind mount 会让同一处出现多次", () => {
    const out = toPartitions([
      { mount: "/", size: 100, used: 50, available: 50 },
      { mount: "/", size: 100, used: 50, available: 50 }
    ])
    expect(out).toHaveLength(1)
  })

  it("没有 mount 时退回 fs（Windows 上偶尔如此），两者都没有则排掉", () => {
    expect(toPartitions([{ fs: "D:\\", size: 50, used: 10, available: 40 }])[0]?.mount).toBe("D:\\")
    expect(toPartitions([{ size: 50 }])).toEqual([])
  })

  it("**`free` 不由 `size - used` 反算** —— ext4 给 root 留的保留块会让两者不等", () => {
    // 100 - 50 = 50，而 available 只有 45：反算会给出一个与 `df` 不一致的数
    expect(toPartitions([{ mount: "/", size: 100, used: 50, available: 45 }])[0]?.free).toBe(45)
  })

  it("available 取不到时才退回反算", () => {
    expect(toPartitions([{ mount: "/", size: 100, used: 50 }])[0]?.free).toBe(50)
  })

  it("used 超过总量时夹到总量，不给出超过 100% 的占用", () => {
    expect(toPartitions([{ mount: "/", size: 100, used: 150, available: 0 }])[0]?.used).toBe(100)
  })

  it("按挂载点字典序，故刷新一次不会让几条互换位置", () => {
    const out = toPartitions([
      { mount: "/home", size: 10, used: 1, available: 9 },
      { mount: "/", size: 10, used: 1, available: 9 }
    ])
    expect(out.map(item => item.mount)).toEqual(["/", "/home"])
  })
})

describe("toIoCounters", () => {
  it("取 rx 与 wx 两个累计量并记下时刻", () => {
    expect(toIoCounters({ rx: 100, wx: 200 }, 5000)).toEqual({ read: 100, write: 200, at: 5000 })
  })

  it("只有一个字段可用时，另一个记 0 —— 那一半确实没有读写", () => {
    expect(toIoCounters({ rx: 100 }, 1)).toEqual({ read: 100, write: 0, at: 1 })
  })

  it("**两个字段都取不到时给 undefined**，好让 ioRates 判定「无从作差」而不是算出 0", () => {
    expect(toIoCounters({}, 1)).toBeUndefined()
    expect(toIoCounters(undefined, 1)).toBeUndefined()
  })
})

describe("ioRates", () => {
  it("按时间差算出每秒字节数", () => {
    const prev = { read: 0, write: 0, at: 1000 }
    const next = { read: 2048, write: 1024, at: 3000 }
    expect(ioRates(prev, next)).toEqual({ read: 1024, write: 512 })
  })

  it("**首次没有上一个采样点时两个字段都不出现** —— 0 会被读成「磁盘闲着」", () => {
    expect(ioRates(undefined, { read: 100, write: 100, at: 1 })).toEqual({})
  })

  it("**累计量倒退时不给该字段**：重启计数器会算出负速率，而「读 -3 MB/s」比没有更糟", () => {
    const prev = { read: 5000, write: 5000, at: 1000 }
    const next = { read: 100, write: 6000, at: 2000 }
    // 读倒退故不出现，写照常
    expect(ioRates(prev, next)).toEqual({ write: 1000 })
  })

  it("时间没有前进时两个字段都不出现（两次采样落在同一毫秒）", () => {
    const at = { read: 0, write: 0, at: 1000 }
    expect(ioRates(at, { read: 100, write: 100, at: 1000 })).toEqual({})
  })
})

describe("DiskSampler", () => {
  /*
   * 这条用例**必须控制时钟**
   *
   * 两次 `sample()` 在真时钟下相隔零到几毫秒，而 `ioRates` 在 `span <= 0` 时按设计
   * 不给速率 —— 于是这条用例在真时钟下是随机成败的（快机器上落在同一毫秒即失败），
   * 而它要验的是「第二次采样算得出速率」，不是「两次调用之间过了多久」。
   *
   * 只替 `Date.now` 一个方法，不用 `useFakeTimers()`：后者会连微任务队列一起接管，
   * 而 `sample()` 内部要 await 两个 `si` 调用。替身在 `afterEach` 里还原 ——
   * 漏掉那一步，此后每条用例都在 12 秒那一刻上跑。
   */
  it("首次采样有分区但没有速率，第二次才有 —— 速率非两点不可得", async () => {
    siFsSize.mockResolvedValue([{ mount: "/", size: 100, used: 40, available: 60 }])
    siFsStats.mockResolvedValue({ rx: 0, wx: 0 })

    vi.spyOn(Date, "now").mockReturnValue(10_000)
    const sampler = new DiskSampler()
    const first = await sampler.sample(() => {})
    expect(first.partitions).toHaveLength(1)
    expect(first.io).toEqual({})

    // 整两秒之后，读累计量涨了 1000 字节 —— 故速率恰为 500 B/s，可以精确断言
    vi.spyOn(Date, "now").mockReturnValue(12_000)
    siFsStats.mockResolvedValue({ rx: 1000, wx: 0 })
    const second = await sampler.sample(() => {})
    expect(second.io).toEqual({ read: 500, write: 0 })
  })

  it("**一半失败不连坐另一半**：探不到读写统计（Termux 常见）仍给得出分区占用", async () => {
    siFsSize.mockResolvedValue([{ mount: "/", size: 100, used: 40, available: 60 }])
    siFsStats.mockRejectedValue(new Error("not supported"))

    const warn = vi.fn()
    const out = await new DiskSampler().sample(warn)
    expect(out.partitions).toHaveLength(1)
    expect(out.io).toEqual({})
    expect(warn).toHaveBeenCalledOnce()
  })

  it("两路都失败时给空分区表与空速率，不抛错 —— 抛错会废掉整个包的 node 侧", async () => {
    siFsSize.mockRejectedValue(new Error("nope"))
    siFsStats.mockRejectedValue(new Error("nope"))

    const out = await new DiskSampler().sample(() => {})
    expect(out).toEqual({ partitions: [], io: {} })
  })
})
