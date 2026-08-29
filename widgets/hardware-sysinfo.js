/**
 * 模块职责：概览页的「系统信息」组件 —— neofetch 式的一行一个事实
 * 依赖方向：只依赖注入的 `api` 与同目录 `lib/store.js`
 * 生命周期：随所在格子
 * 注意事项：**这一枚与内核的「运行时」表不重叠。** 那张表说的是内核自己（版本、运行时长、目录布局），
 *          这一枚说的是这台机器（发行版、内核版本、机型、本机 IP）。两者都有「运行了多久」，但一个是
 *          进程的、一个是开机以来的 —— 故此处写作「开机」并在底部小字点明。
 *
 *          **操作系统与机型两项要等一轮。** 它们要起子进程（合计约两秒），node 侧首次请求不等它们探完，
 *          故此处缺这两项时**不显示那两行**而不是显示「读取中」—— 下一拍就有了，而一行「读取中」会在
 *          五秒内变成正文，闪一下反而显眼。
 *
 *          **IP 只列前两条，余下记一行计数。** 一台装了 Docker 与 WSL 的机器上有五六个网卡，全列出来
 *          这一格就只剩 IP 了。余下几条给一行计数而不是默默丢掉：网卡有几个本身就是有用的事实。
 */
import { card, empty, kv, useEndpoint } from "./lib/store.js"

/** 地址列几行，余下的合成一行计数 */
const ADDRESS_ROWS = 2

/*
 * 默认 h=6，由实测定出而非估算
 *
 * 本机实测（1600px 宽、4 列）：10 行，其中「系统」那行因发行版名字长而折成 60px，
 * 其余各 38px，表共 402px，内容盒要 405px。卡片里除内容之外的壳子固定占 87px
 * （标题 24px + 其下 8px + 小字 21px + 上下内边距各 16px），故卡片至少要 492px。
 * 行高 80px、间隙 16px，h=5 只有 464px（内容盒 377px，差 28px），只能上到 h=6
 * 的 560px。**默认布局不该需要滚动**，同一条原则。
 *
 * 折行那一行是关键，两版都在这里失手：按「10 行 × 38px」估得 380px，看似落在
 * h=4 之内 —— 而发行版全名（「Microsoft Windows 11 家庭版 中文版 10.0.26200」）
 * 在 4 列宽里必然折行，估算漏掉的就是这一行的第二行。h=4 差 87px 是这么来的。
 *
 * 上一版写 h=5 也仍差 28px，因为「表 287px」那个数是错的：把它与逐行量出的
 * 「9×38 + 60 = 402px」对一下即可 —— 前者比后者少了三行有余，估算冒充了实测。
 * 这一处不靠肉眼看图发现，`temp/diag-cardnote.mjs` 量的是内容盒的
 * `scrollHeight > clientHeight`。
 */
export default {
  id: "hardware.sysinfo",
  page: "overview",
  title: "系统信息",
  defaultLayout: { w: 4, h: 6, minW: 3, minH: 3, resizable: true },
  defaultHidden: true,

  /**
   * 建立组件状态
   * @param {object} api 注入的面板能力
   * @returns {Function} 渲染函数
   */
  setup(api) {
    const { data, error } = useEndpoint(api, "sysinfo")

    /** 底部小字：点明「开机」与内核运行时长的差别 */
    const note = api.computed(() =>
      error.value === "" ? "本机信息 · 开机时长非内核运行时长" : `更新失败：${error.value}`
    )

    return () => {
      const info = data.value
      if (info === undefined) return card(api, "系统信息", empty(api, "读取中"), note.value)

      const rows = []
      rows.push(["主机名", info.hostname])
      // 操作系统与机型要等一轮子进程探测，缺时整行不出现（见文件头）
      if (info.os !== undefined) rows.push(["系统", info.os])
      rows.push(["内核", info.kernel])
      rows.push(["架构", info.arch])
      if (info.model !== undefined) rows.push(["机型", info.model])
      rows.push(["开机", api.fmt.duration(info.bootUptime)])
      rows.push(["Node", info.node])

      /*
       * 地址只列前两条，余下的记一行计数
       *
       * 初版把全部地址逐行列出，与文件头「只列前两条」自相矛盾 —— 而本机实测 8 条
       * （Radmin、WSL、Docker、以太网、无线各占一两条），于是这一格光 IP 就八行，
       * 加上另外七项共十二行，溢出格子 660px。
       *
       * 余下几条给一行计数而不是默默丢掉：一台机器有几个网卡本身就是有用的事实，
       * 而「装了 Docker 与 WSL 所以有五个网卡」正是使用者需要知道自己不必担心的那类。
       */
      const addresses = info.addresses ?? []
      if (addresses.length === 0) {
        rows.push(["地址", "无对外地址"])
      } else {
        for (const item of addresses.slice(0, ADDRESS_ROWS)) {
          rows.push([item.iface, `${item.address} · ${item.family}`])
        }
        if (addresses.length > ADDRESS_ROWS) {
          rows.push(["其余网卡", `另有 ${addresses.length - ADDRESS_ROWS} 个地址`])
        }
      }

      return card(api, "系统信息", kv(api, rows), note.value)
    }
  }
}
