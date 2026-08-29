/**
 * 模块职责：neofetch 式的系统信息清单 —— 发行版、内核版本、机型、本机 IP、开机时长
 * 依赖方向：只依赖 node 内置模块与 `systeminformation`；不认识 HTTP，也不认识面板
 * 生命周期：`SysInfoSampler` 随插件建立一份；这些值一次运行里几乎不变，故只探一次
 * 注意事项：**这一份只探一次，不随节拍刷新。** 发行版、内核版本、机型、CPU 型号在一次
 *          运行里不会变；开机时长虽然在变，但它由 `os.uptime()` 现算，不必重探。
 *          实测 `si.osInfo()` 约 1.4 秒、`si.system()` 约 0.6 秒 —— 若跟着 5 秒的节拍
 *          反复探，等于每 5 秒烧两秒 CPU 去取一组常量。
 *
 *          **本机 IP 取自 `os.networkInterfaces()`，不是 `si.networkInterfaces()`。**
 *          前者是纯内存读取，后者要起子进程。这里只要「哪些地址是本机的」，
 *          而那正是 node 内置就能完整回答的事。
 *
 *          **回环地址一律排掉，IPv6 链路本地地址（fe80::）也排掉。** 前者是 127.0.0.1，
 *          写在「本机 IP」一栏里毫无信息量；后者带 `%eth0` 这样的作用域后缀，
 *          在面板上只会占掉一行的宽度而无从使用。
 *
 *          **探不到的项一律不出现，不填「未知」。** 一行「内核版本：未知」比没有这一行
 *          更糟：它让使用者以为探测出了错，而实际是这个平台上本就没有这个概念。
 */
import { arch, hostname, networkInterfaces, platform, release, type, uptime } from "node:os"
import si from "systeminformation"

/** 一条本机地址 */
export interface LocalAddress {
  /** 网卡名，如 `以太网` / `eth0` */
  readonly iface: string
  /** IPv4 或 IPv6 地址 */
  readonly address: string
  /** 协议族 */
  readonly family: "IPv4" | "IPv6"
}

/** neofetch 式的系统信息 */
export interface SysInfo {
  /** 主机名 */
  readonly hostname: string
  /** 操作系统名，如 `Windows 11 家庭中文版` / `Ubuntu 24.04 LTS` */
  readonly os?: string
  /** 内核类型与版本，如 `Windows_NT 10.0.26200` */
  readonly kernel: string
  /** CPU 架构，如 `x64` */
  readonly arch: string
  /** 机型，如 `LENOVO 21MV` */
  readonly model?: string
  /** 开机至今（毫秒） */
  readonly bootUptime: number
  /** node 版本 */
  readonly node: string
  /** 本机地址；一条都没有时为空数组 */
  readonly addresses: readonly LocalAddress[]
}

/**
 * 列出本机地址
 *
 * 排掉回环与 IPv6 链路本地地址，理由见文件头。
 * @param table `os.networkInterfaces()` 的返回值
 * @returns 本机地址；一条都没有时为空数组
 */
export function toAddresses(
  table: Record<
    string,
    readonly { address: string; family: string | number; internal: boolean }[] | undefined
  >
): LocalAddress[] {
  const out: LocalAddress[] = []
  for (const [iface, list] of Object.entries(table)) {
    for (const item of list ?? []) {
      if (item.internal) continue
      if (item.address.toLowerCase().startsWith("fe80")) continue
      // node 18 起 family 是 "IPv4" / "IPv6"，更早是 4 / 6 —— 两种都认
      const family = item.family === "IPv4" || item.family === 4 ? "IPv4" : "IPv6"
      out.push({ iface, address: item.address, family })
    }
  }
  return out
}

/**
 * 拼出内核标识
 *
 * `os.type()` 给 `Windows_NT` / `Linux` / `Darwin`，`os.release()` 给版本号。
 * 两者合起来才是 neofetch 里「Kernel」那一行的样子。
 * @returns 内核类型与版本
 */
export function kernelOf(): string {
  return `${type()} ${release()}`
}

/** 系统信息采样器：探一次记住 */
export class SysInfoSampler {
  /** 探到的信息；尚未探完时 undefined */
  #info: SysInfo | undefined

  /** 是否正在探，避免多枚组件的首次请求各起一次 */
  #probing = false

  /**
   * 取一份系统信息
   *
   * 首次调用**就地发起探测但不等它**（与 `probe.ts` 的型号探测同一策略）：
   * `si.osInfo()` 与 `si.system()` 合计约两秒，而面板正等着第一份数据。
   * 那些不必探的项（主机名、内核、架构、开机时长、node 版本）**首次就给** ——
   * 它们全是纯内存读取，没有理由让使用者等。
   * @param warn 出错时的告知方式
   * @returns 系统信息
   */
  async sample(warn: (message: string, err: unknown) => void): Promise<SysInfo> {
    const base: SysInfo = {
      hostname: hostname(),
      kernel: kernelOf(),
      arch: arch(),
      bootUptime: Math.round(uptime() * 1000),
      node: process.version,
      addresses: toAddresses(networkInterfaces())
    }

    if (this.#info !== undefined) {
      // 记住的那份里 os / model 是常量，而开机时长与地址要用新的
      return { ...this.#info, ...base }
    }

    if (!this.#probing) {
      this.#probing = true
      void this.#probe(warn).finally(() => {
        this.#probing = false
      })
    }
    return base
  }

  /**
   * 探那两项要起子进程的
   * @param warn 出错时的告知方式
   * @returns 探完即结束
   */
  async #probe(warn: (message: string, err: unknown) => void): Promise<void> {
    const [os, system] = await Promise.all([
      si.osInfo().catch((err: unknown) => {
        warn("探测操作系统信息失败", err)
        return undefined
      }),
      si.system().catch((err: unknown) => {
        warn("探测机型失败", err)
        return undefined
      })
    ])

    const distro = [os?.distro, os?.release].filter(v => v !== undefined && v !== "").join(" ")
    const model = [system?.manufacturer, system?.model]
      .filter(v => v !== undefined && v !== "" && v !== "System Product Name")
      .join(" ")

    this.#info = {
      hostname: hostname(),
      kernel: kernelOf(),
      arch: arch(),
      bootUptime: Math.round(uptime() * 1000),
      node: process.version,
      addresses: toAddresses(networkInterfaces()),
      ...(distro === "" ? {} : { os: distro }),
      ...(model === "" ? {} : { model })
    }
  }
}

/** 供用例断言平台判断没有写死在某一个系统上 */
export const PLATFORM = platform()
