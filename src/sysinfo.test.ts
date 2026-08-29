/**
 * `sysinfo.ts` 的用例
 *
 * `systeminformation` 那两项（`osInfo` / `system`）用 mock：真跑一遍约两秒，且返回值
 * 随机器而变 —— 本机上 `distro` 是「Windows 11 家庭中文版」，CI 上是别的，断言无从写。
 * `node:os` 那几个**走真的**：它们是纯内存读取，且用例断言的正是「首次就给这几项」，
 * 而 mock 掉它们等于把这条断言变成「mock 返回了我塞进去的值」。
 *
 * 断言的重点是那个**两段式**：首次给纯内存读取的几项、不等子进程；探完之后 os 与 model
 * 出现，而开机时长与地址取新的而非记住的。后半条尤其要紧 —— 记住整份的话，
 * 「开机至今」会永远停在插件启动那一刻。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const siOsInfo = vi.fn<() => Promise<unknown>>()
const siSystem = vi.fn<() => Promise<unknown>>()

vi.mock("systeminformation", () => ({
  default: {
    osInfo: (): Promise<unknown> => siOsInfo(),
    system: (): Promise<unknown> => siSystem()
  }
}))

const { PLATFORM, SysInfoSampler, kernelOf, toAddresses } = await import("./sysinfo.js")

beforeEach(() => {
  vi.clearAllMocks()
  siOsInfo.mockResolvedValue({ distro: "Ubuntu", release: "24.04 LTS" })
  siSystem.mockResolvedValue({ manufacturer: "LENOVO", model: "21MV" })
})

describe("toAddresses", () => {
  it("列出网卡名、地址与协议族", () => {
    expect(
      toAddresses({ eth0: [{ address: "192.168.1.9", family: "IPv4", internal: false }] })
    ).toEqual([{ iface: "eth0", address: "192.168.1.9", family: "IPv4" }])
  })

  it("**排掉回环** —— 127.0.0.1 不是「本机在网络上的地址」", () => {
    expect(toAddresses({ lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }] })).toEqual([])
  })

  it("**排掉 IPv6 链路本地地址**：fe80:: 一段只在本网段内有意义，且每块网卡都有一个", () => {
    expect(
      toAddresses({ eth0: [{ address: "fe80::1234:5678:9abc:def0", family: "IPv6", internal: false }] })
    ).toEqual([])
  })

  it("大写的 FE80 同样排掉 —— 判断按小写比", () => {
    expect(toAddresses({ eth0: [{ address: "FE80::1", family: "IPv6", internal: false }] })).toEqual([])
  })

  it("**family 给数字 4 也认作 IPv4** —— node 18 之前是数字", () => {
    expect(toAddresses({ eth0: [{ address: "10.0.0.2", family: 4, internal: false }] })[0]?.family).toBe(
      "IPv4"
    )
  })

  it("family 给数字 6 认作 IPv6", () => {
    expect(toAddresses({ eth0: [{ address: "2001:db8::1", family: 6, internal: false }] })[0]?.family).toBe(
      "IPv6"
    )
  })

  it("一块网卡有多个地址时各列一条", () => {
    const table = {
      eth0: [
        { address: "192.168.1.9", family: "IPv4", internal: false },
        { address: "2001:db8::9", family: "IPv6", internal: false }
      ]
    }
    expect(toAddresses(table)).toHaveLength(2)
  })

  it("网卡的条目为 undefined 时跳过，不抛错", () => {
    expect(toAddresses({ eth0: undefined })).toEqual([])
  })

  it("一块可用网卡都没有时给空数组", () => {
    expect(toAddresses({})).toEqual([])
  })
})

describe("kernelOf", () => {
  it("把类型与版本拼成一行，即 neofetch 的 Kernel 那一行", () => {
    // 断言形状而非具体值：具体值随机器而变，而「两段之间有一个空格」是本函数的全部内容
    expect(kernelOf()).toMatch(/^\S+ \S+/)
  })
})

describe("PLATFORM", () => {
  it("**平台判断取自 os.platform()，没有写死在某一个系统上**", () => {
    expect(["win32", "linux", "darwin", "android", "freebsd", "openbsd", "sunos", "aix"]).toContain(
      PLATFORM
    )
  })
})

describe("SysInfoSampler", () => {
  it("**首次就给那些纯内存读取的项**，不等两秒的子进程", async () => {
    const first = await new SysInfoSampler().sample(() => {})
    expect(first.hostname).not.toBe("")
    expect(first.kernel).toMatch(/^\S+ \S+/)
    expect(first.arch).not.toBe("")
    expect(first.node).toBe(process.version)
    expect(first.bootUptime).toBeGreaterThan(0)
  })

  it("**首次不带 os 与 model** —— 它们要等子进程，而面板正等第一份数据", async () => {
    const first = await new SysInfoSampler().sample(() => {})
    expect(first.os).toBeUndefined()
    expect(first.model).toBeUndefined()
  })

  it("探完之后 os 与 model 出现，各由两段拼成", async () => {
    const sampler = new SysInfoSampler()
    await sampler.sample(() => {})
    await vi.waitFor(async () => {
      const later = await sampler.sample(() => {})
      expect(later.os).toBe("Ubuntu 24.04 LTS")
      expect(later.model).toBe("LENOVO 21MV")
    })
  })

  it("**开机时长取新的，不是记住的那份里的** —— 否则它会永远停在插件启动那一刻", async () => {
    const sampler = new SysInfoSampler()
    await sampler.sample(() => {})
    await vi.waitFor(async () => {
      expect((await sampler.sample(() => {})).os).toBe("Ubuntu 24.04 LTS")
    })

    const a = await sampler.sample(() => {})
    await new Promise(r => setTimeout(r, 1100))
    const b = await sampler.sample(() => {})
    expect(b.bootUptime).toBeGreaterThan(a.bootUptime)
  })

  it("**`System Product Name` 这类占位机型排掉** —— 主板厂商没填时的默认值", async () => {
    siSystem.mockResolvedValue({ manufacturer: "", model: "System Product Name" })
    const sampler = new SysInfoSampler()
    await sampler.sample(() => {})
    await vi.waitFor(async () => {
      expect((await sampler.sample(() => {})).os).toBe("Ubuntu 24.04 LTS")
    })
    expect((await sampler.sample(() => {})).model).toBeUndefined()
  })

  it("distro 与 release 只有一项时不留下多余空格", async () => {
    siOsInfo.mockResolvedValue({ distro: "Alpine Linux", release: "" })
    const sampler = new SysInfoSampler()
    await sampler.sample(() => {})
    await vi.waitFor(async () => {
      expect((await sampler.sample(() => {})).os).toBe("Alpine Linux")
    })
  })

  it("两项都探不到时不给 os，其余照常", async () => {
    siOsInfo.mockResolvedValue({})
    siSystem.mockResolvedValue({})
    const sampler = new SysInfoSampler()
    const first = await sampler.sample(() => {})
    expect(first.hostname).not.toBe("")
    await vi.waitFor(() => {
      expect(siOsInfo).toHaveBeenCalled()
    })
    expect((await sampler.sample(() => {})).os).toBeUndefined()
  })

  it("探测抛错时告知一句，且照常给出那些纯内存读取的项", async () => {
    siOsInfo.mockRejectedValue(new Error("no /etc/os-release"))
    const warn = vi.fn()
    const sampler = new SysInfoSampler()
    expect((await sampler.sample(warn)).hostname).not.toBe("")
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith("探测操作系统信息失败", expect.any(Error))
    })
  })

  it("**多枚组件的首次请求只起一次探测** —— 五枚组件不该各 spawn 一次子进程", async () => {
    const sampler = new SysInfoSampler()
    await Promise.all([
      sampler.sample(() => {}),
      sampler.sample(() => {}),
      sampler.sample(() => {})
    ])
    await vi.waitFor(() => {
      expect(siOsInfo).toHaveBeenCalled()
    })
    expect(siOsInfo).toHaveBeenCalledTimes(1)
  })
})
