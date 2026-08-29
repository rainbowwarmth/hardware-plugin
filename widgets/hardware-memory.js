/**
 * 模块职责：概览页的「内存」双色环 —— 同一枚环上整机与本进程各一段
 * 依赖方向：只依赖注入的 `api` 与同目录 `lib/store.js`
 * 生命周期：随所在格子
 * 注意事项：**标题就叫「内存」，不带「（全机）」。** 内置的本进程内存环已撤，
 *          故这一枚是页面上唯一的内存环，无须限定词来与另一枚区分。这一条与「撤掉内置环」
 *          互为前提：内置环还在时，不加限定词就有两个「内存占用」。
 *
 *          **两个数取自两个接口。** 整机走本包的 node 侧（`totalmem() - freemem()`，
 *          与任务管理器同源），本进程走内核既有的 `/api/overview`（`usage.rss`）——
 *          不必为此在 node 侧再采一遍本进程占用，内核早就有了。
 *
 *          **本进程那段的分母是整机内存，不是它自己的上限。** 「机器人吃了整机内存的 2%」
 *          才与外环可比；换成「吃了堆上限的 60%」则两段的分母不同，叠在一枚环上无从解读。
 */
import { gaugeCard, ring, useHardware, useOverview } from "./lib/store.js"

export default {
  id: "hardware.memory",
  page: "overview",
  title: "内存",
  defaultLayout: { w: 3, h: 3, minW: 2, minH: 3, resizable: true },

  /**
   * 建立组件状态
   * @param {object} api 注入的面板能力
   * @returns {Function} 渲染函数
   */
  setup(api) {
    const { data, error } = useHardware(api)
    const overview = useOverview(api)

    /** 整机内存占用（0-1） */
    const total = api.computed(() => {
      const mem = data.value?.memory
      return mem === undefined ? undefined : api.fmt.ratioOf(mem.used, mem.total)
    })

    /** 本进程占整机内存的比例（0-1） */
    const own = api.computed(() => {
      const rss = overview.data.value?.usage?.rss
      const mem = data.value?.memory
      return rss === undefined || mem === undefined ? undefined : api.fmt.ratioOf(rss, mem.total)
    })

    /** 底部小字：两段各是什么，加上型号 */
    const note = api.computed(() => {
      if (error.value !== "") return `更新失败：${error.value}`
      const mem = data.value?.memory
      if (mem === undefined) return "整机 / 本进程"
      /*
       * 两段各自冠名，不靠位置暗示
       *
       * 初版写作「16.9 GB / 32 GB · 本进程 76 MB」—— 后一半点了名，前一半没有，
       * 于是那个「16.9 GB」是整机还是本进程只能靠「它排在前面」去猜。而这枚环上
       * 恰有两段颜色要对应到这两个数，图例缺一半等于没有图例。
       */
      const parts = [`整机 ${api.fmt.bytes(mem.used)} / ${api.fmt.bytes(mem.total)}`]
      const rss = overview.data.value?.usage?.rss
      if (rss !== undefined) parts.push(`本进程 ${api.fmt.bytes(rss)}`)
      const models = data.value?.models
      if (models?.memoryType !== undefined) {
        parts.push(
          models.memoryClock === undefined
            ? models.memoryType
            : `${models.memoryType} ${models.memoryClock} MHz`
        )
      }
      return parts.join(" · ")
    })

    return () => gaugeCard(api, ring(api, "内存", total.value, own.value, note.value))
  }
}
