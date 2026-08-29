/**
 * 模块职责：磁盘 —— 各分区的占用，以及全盘读写速率
 * 依赖方向：只依赖 `systeminformation`；不认识 HTTP，也不认识面板
 * 生命周期：速率需要两个采样点，故状态存在 `DiskSampler` 实例里
 * 注意事项：**速率自己按累计量作差，不用 `si.fsStats()` 的 `rx_sec` / `wx_sec`。**
 *          那两个字段在**首次调用时为 null**（库内部同样要两个采样点），而本插件的
 *          缓存是 4 秒一份、面板 5 秒一轮询 —— 若照抄那两个字段，第一次打开面板看到的
 *          是两条 null，第二次才有数。自己作差的好处是「有没有上一个采样点」这件事
 *          由本模块说了算，与库的内部状态无关，且与 CPU 那一路（`cpuLoad`）同一形制。
 *
 *          **首次没有速率时该字段不出现，不记 0。** 与 CPU 同一理由：0 会被读成
 *          「这块盘闲着」，而真相是「还没有第二个采样点」。
 *
 *          **分区列表排掉两类。** 一是总量为 0 的（未插盘的读卡器、某些伪文件系统），
 *          二是重复挂载点 —— Linux 上同一设备常挂在多处（`/` 与 `/snap/...` 之类），
 *          全列出来会让一台普通机器的磁盘卡片有二十几条，而其中二十条是同一块盘。
 *
 *          **不按「系统盘优先」排序，按挂载点字典序。** 排序规则一旦掺入判断
 *          （哪个是系统盘），跨平台就要各写一套，而使用者真正需要的是「每次打开
 *          顺序都一样」—— 字典序已足够。
 */
import si from "systeminformation"

/** 一个分区的占用 */
export interface DiskPartition {
  /** 挂载点；Windows 上形如 `C:` */
  readonly mount: string
  /** 文件系统类型，如 `NTFS` / `ext4`；取不到时不出现 */
  readonly type?: string
  /** 总容量（字节） */
  readonly total: number
  /** 已用（字节） */
  readonly used: number
  /** 可用（字节） */
  readonly free: number
}

/** 全盘读写的累计量，单位字节 */
export interface DiskIoCounters {
  /** 累计读入 */
  readonly read: number
  /** 累计写出 */
  readonly write: number
  /** 采样时刻（毫秒时间戳） */
  readonly at: number
}

/** 全盘读写速率，单位字节每秒 */
export interface DiskIoRates {
  /** 读速率；无上一个采样点时不出现 */
  readonly read?: number
  /** 写速率；无上一个采样点时不出现 */
  readonly write?: number
}

/** 磁盘整体 */
export interface DiskInfo {
  /** 各分区；一个都探不到时为空数组 */
  readonly partitions: readonly DiskPartition[]
  /** 全盘读写速率 */
  readonly io: DiskIoRates
}

/**
 * 把 `si.fsSize()` 的结果收成分区列表
 *
 * 排掉总量为 0 的与重复挂载点，理由见文件头。导出以便用例直接喂夹具 ——
 * 真机上跑不出「同一设备挂在多处」这种情形（那要一台特定的 Linux）。
 * @param list `si.fsSize()` 的返回值
 * @returns 分区列表，按挂载点字典序
 */
export function toPartitions(
  list: readonly {
    readonly mount?: string
    readonly fs?: string
    readonly type?: string
    readonly size?: number
    readonly used?: number
    readonly available?: number
  }[]
): DiskPartition[] {
  const seen = new Set<string>()
  const out: DiskPartition[] = []
  for (const item of list) {
    const mount = item.mount ?? item.fs ?? ""
    const total = Number(item.size)
    if (mount === "" || !Number.isFinite(total) || total <= 0) continue
    if (seen.has(mount)) continue
    seen.add(mount)

    const used = Number(item.used)
    const usedOk = Number.isFinite(used) && used >= 0 ? Math.min(used, total) : 0
    // `available` 常小于 `size - used`（ext4 给 root 留的保留块），故各自照原样取，
    // 不由另一个反算 —— 反算出的数与 `df` 不一致，而使用者会拿 `df` 对
    const free = Number(item.available)
    const freeOk = Number.isFinite(free) && free >= 0 ? Math.min(free, total) : total - usedOk

    out.push({
      mount,
      ...(item.type === undefined || item.type === "" ? {} : { type: item.type }),
      total,
      used: usedOk,
      free: freeOk
    })
  }
  return out.sort((a, b) => a.mount.localeCompare(b.mount))
}

/**
 * 汇总 `si.fsStats()` 的累计读写量
 * @param stats `si.fsStats()` 的返回值
 * @param now 采样时刻
 * @returns 累计量；两个字段都取不到时 undefined
 */
export function toIoCounters(
  stats: { readonly rx?: number; readonly wx?: number } | undefined,
  now: number
): DiskIoCounters | undefined {
  const read = Number(stats?.rx)
  const write = Number(stats?.wx)
  if (!Number.isFinite(read) && !Number.isFinite(write)) return undefined
  return {
    read: Number.isFinite(read) ? read : 0,
    write: Number.isFinite(write) ? write : 0,
    at: now
  }
}

/**
 * 由两个采样点算出读写速率
 *
 * 没有上一个采样点、时间没有前进、或累计量倒退（重启计数器、切换了设备）时该字段
 * 不出现 —— 倒退时算出来的是个负数，而「读速率 -3 MB/s」比没有这个数更糟。
 * @param prev 上一个采样点，首次为 undefined
 * @param next 本次采样点
 * @returns 速率（字节每秒）
 */
export function ioRates(
  prev: DiskIoCounters | undefined,
  next: DiskIoCounters | undefined
): DiskIoRates {
  if (prev === undefined || next === undefined) return {}
  const span = (next.at - prev.at) / 1000
  if (!Number.isFinite(span) || span <= 0) return {}
  const read = (next.read - prev.read) / span
  const write = (next.write - prev.write) / span
  return {
    ...(Number.isFinite(read) && read >= 0 ? { read } : {}),
    ...(Number.isFinite(write) && write >= 0 ? { write } : {})
  }
}

/** 磁盘采样器：持有上一个读写累计量 */
export class DiskSampler {
  /** 上一个读写采样点 */
  #prev: DiskIoCounters | undefined

  /**
   * 采一份磁盘快照
   *
   * 两个 `si` 调用并发（彼此无关），任一失败只让那一半缺失：一台探不到 `fsStats`
   * 的机器（Termux 常见）仍该看得见分区占用。
   * @param warn 出错时的告知方式
   * @returns 磁盘快照
   */
  async sample(warn: (message: string, err: unknown) => void): Promise<DiskInfo> {
    const [sizes, stats] = await Promise.all([
      si.fsSize().catch((err: unknown) => {
        warn("探测分区占用失败", err)
        return undefined
      }),
      si.fsStats().catch((err: unknown) => {
        warn("探测磁盘读写失败", err)
        return undefined
      })
    ])

    const next = toIoCounters(stats, Date.now())
    const io = ioRates(this.#prev, next)
    if (next !== undefined) this.#prev = next

    return { partitions: toPartitions(sizes ?? []), io }
  }
}
