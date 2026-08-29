/**
 * 模块职责：Redis 监控 —— 连一次、发 `INFO`、把回文解析成几个可显示的数
 * 依赖方向：只依赖 node 的 `net`；**不引 redis 客户端库**
 * 生命周期：每次采样各建一条短连接，用完即关
 * 注意事项：**不引任何 redis 客户端库。** 要做的事只有一件：发一条 `INFO` 读回一段文本 ——
 *          RESP 里那是 `*1\r\n$4\r\nINFO\r\n`，回文是一个批量字符串，合起来约三十行。客户端库带来的
 *          是连接池、集群、Lua、管道、重连策略与数百 KB 产物，没有一项是这件事需要的；而面板插件包的
 *          依赖要使用者自己装，每个依赖都是一次真实的等待。
 *
 *          **短连接，不常驻。** 常驻要处理断线重连、心跳与退出清理，而采样是 5 秒一次 —— 本机一次
 *          TCP 握手是亚毫秒级，常驻换来的提升在这个频率下测不出来，代价却是三类状态要维护。
 *
 *          **连不上不是错误，是一种状态。** 多数部署没有 Redis，故此时卡片显示「未连接」并说明原因，
 *          而不是画一片红字。真正该报警的是「配置了 Redis 却连不上」。
 *
 *          **`INFO` 的回文不逐字段解析。** 它有上百个字段且随版本变动，只取面板要显示的那几个 ——
 *          全都解析等于维护一份 Redis 版本兼容表。
 */
import { createConnection } from "node:net"

/** 默认连接地址：Redis 的约定端口 */
export const DEFAULT_HOST = "127.0.0.1"

/** 默认端口 */
export const DEFAULT_PORT = 6379

/**
 * 连接与读取的超时
 *
 * 取 1.5 秒：本机 Redis 的 `INFO` 是毫秒级的，而没有 Redis 时连接会立刻被拒
 * （ECONNREFUSED，不必等超时）。这个数只用于兜住「地址可达但对方不回话」那种情形 ——
 * 一个防火墙丢包的地址会让请求悬着，而面板 5 秒一拍，悬 5 秒以上就会拖住整份快照。
 */
const TIMEOUT_MS = 1500

/** Redis 的运行状况 */
export interface RedisInfo {
  /** 是否连上了 */
  readonly connected: boolean
  /** 连不上时的原因，如 `ECONNREFUSED` */
  readonly reason?: string
  /** 版本号，如 `7.2.4` */
  readonly version?: string
  /** 当前客户端连接数 */
  readonly clients?: number
  /** 已用内存（字节） */
  readonly memoryUsed?: number
  /** 内存上限（字节）；未设 `maxmemory` 时不出现 */
  readonly memoryMax?: number
  /** 键总数（全部 db 之和） */
  readonly keys?: number
  /** 命中率（0-1）；累计命中与未命中都为 0 时不出现 */
  readonly hitRate?: number
  /** 运行时长（毫秒） */
  readonly uptime?: number
  /** 每秒处理的命令数 */
  readonly ops?: number
}

/**
 * 把 `INFO` 的回文解析成键值表
 *
 * 回文形如 `# Server\r\nredis_version:7.2.4\r\n...`。注释行（`#` 开头）与空行跳过。
 * @param text `INFO` 的回文
 * @returns 键值表
 */
export function parseInfo(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (line === "" || line.startsWith("#")) continue
    const at = line.indexOf(":")
    if (at <= 0) continue
    out.set(line.slice(0, at), line.slice(at + 1))
  }
  return out
}

/**
 * 取一个数字字段
 * @param info 键值表
 * @param key 字段名
 * @returns 数值；缺失或非数时 undefined
 */
function num(info: Map<string, string>, key: string): number | undefined {
  const raw = info.get(key)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * 数出全部 db 的键总数
 *
 * `INFO` 里每个 db 一行，形如 `db0:keys=12,expires=3,avg_ttl=0`。
 * @param info 键值表
 * @returns 键总数；一个 db 都没有时为 0
 */
export function countKeys(info: Map<string, string>): number {
  let total = 0
  for (const [key, value] of info) {
    if (!/^db\d+$/.test(key)) continue
    const found = /keys=(\d+)/.exec(value)
    if (found !== null) total += Number(found[1])
  }
  return total
}

/**
 * 算命中率
 *
 * 两者皆为 0 时返回 undefined 而非 0：那意味着这台 Redis 还没被读过，
 * 而「命中率 0%」会被读成「缓存全都没命中」—— 那是两件相反的事。
 * @param info 键值表
 * @returns 命中率（0-1）
 */
export function hitRateOf(info: Map<string, string>): number | undefined {
  const hits = num(info, "keyspace_hits") ?? 0
  const misses = num(info, "keyspace_misses") ?? 0
  const total = hits + misses
  return total <= 0 ? undefined : hits / total
}

/**
 * 把键值表整理成面板要的形状
 * @param info 键值表
 * @returns Redis 运行状况
 */
export function toRedisInfo(info: Map<string, string>): RedisInfo {
  const maxMemory = num(info, "maxmemory")
  const uptimeSec = num(info, "uptime_in_seconds")
  const hitRate = hitRateOf(info)
  const version = info.get("redis_version")
  const clients = num(info, "connected_clients")
  const used = num(info, "used_memory")
  const ops = num(info, "instantaneous_ops_per_sec")

  return {
    connected: true,
    ...(version === undefined || version === "" ? {} : { version }),
    ...(clients === undefined ? {} : { clients }),
    ...(used === undefined ? {} : { memoryUsed: used }),
    // maxmemory 为 0 意为「不限」，此时不给这个字段 —— 画一条分母为 0 的槽毫无意义
    ...(maxMemory === undefined || maxMemory <= 0 ? {} : { memoryMax: maxMemory }),
    keys: countKeys(info),
    ...(hitRate === undefined ? {} : { hitRate }),
    ...(uptimeSec === undefined ? {} : { uptime: Math.round(uptimeSec * 1000) }),
    ...(ops === undefined ? {} : { ops })
  }
}

/**
 * 连一次 Redis 并取回 `INFO` 的原文
 *
 * 手写 RESP 的两个方向：发出去的是一条数组形式的命令，收回来的是一个批量字符串。
 * **按声明的长度收全再解析**，不以「收到了 `\r\n`」为界 —— `INFO` 的正文有几千字节，
 * 必然分成多个 TCP 包到达，而正文里本身就含大量 `\r\n`。
 * @param host 主机
 * @param port 端口
 * @returns `INFO` 的正文
 */
export function fetchInfo(host: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    socket.setTimeout(TIMEOUT_MS)

    /** 已收到的字节 */
    const chunks: Buffer[] = []

    /**
     * 收尾：关掉连接并只回一次
     * @param err 出错原因；成功时 undefined
     * @param text 正文
     */
    const done = (err: Error | undefined, text?: string): void => {
      socket.removeAllListeners()
      socket.destroy()
      if (err !== undefined) reject(err)
      else resolve(text ?? "")
    }

    socket.on("connect", () => {
      // RESP：一个含单个批量字符串的数组，即 `INFO`
      socket.write("*1\r\n$4\r\nINFO\r\n")
    })

    socket.on("data", buf => {
      chunks.push(buf)
      const all = Buffer.concat(chunks)
      const head = all.indexOf("\r\n")
      if (head < 0) return

      const prefix = all.subarray(0, head).toString("latin1")
      // `-ERR ...` 是错误回复；此处唯一可能的成因是对方要 AUTH
      if (prefix.startsWith("-")) {
        done(new Error(prefix.slice(1)))
        return
      }
      if (!prefix.startsWith("$")) {
        done(new Error(`回复不是批量字符串：${prefix.slice(0, 40)}`))
        return
      }

      const length = Number(prefix.slice(1))
      if (!Number.isFinite(length) || length < 0) {
        done(new Error("回复声明的长度不是正整数"))
        return
      }
      // 按声明的长度收全，理由见函数注释
      if (all.length < head + 2 + length) return
      done(undefined, all.subarray(head + 2, head + 2 + length).toString("utf8"))
    })

    socket.on("timeout", () => done(new Error("ETIMEDOUT")))
    socket.on("error", err => done(err))
    socket.on("close", () => done(new Error("连接被对方关闭")))
  })
}

/**
 * 采一次 Redis 状况
 *
 * **连不上时不抛错**，返回 `connected: false` 加一句原因 —— 理由见文件头：
 * 多数部署没有 Redis，那是常态而非故障。
 * @param host 主机，缺省 `127.0.0.1`
 * @param port 端口，缺省 6379
 * @returns Redis 运行状况
 */
export async function sampleRedis(host = DEFAULT_HOST, port = DEFAULT_PORT): Promise<RedisInfo> {
  try {
    return toRedisInfo(parseInfo(await fetchInfo(host, port)))
  } catch (err) {
    const code = (err as { code?: string }).code
    return {
      connected: false,
      reason: code ?? (err instanceof Error ? err.message : String(err))
    }
  }
}
