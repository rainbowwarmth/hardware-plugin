/**
 * 模块职责：概览页的「CPU」组件 —— 一枚双色环，整机与本进程占用同环异色
 * 依赖方向：只 import 同目录下的 `lib/store.js`（同源相对路径）；不 import 任何包
 * 生命周期：随所在格子；节拍订阅由 `api.onTick` 在卸载时自动退订
 * 注意事项：**标题就叫「CPU」，不带「（全机）」。** webui 已撤掉那枚本进程环，故这一页上不再有第二个
 *          叫 CPU 的东西，限定词失去意义。反过来说这个标题与「撤掉内置环」互为前提 —— 内置环还在时
 *          不加限定词就有两个「CPU 占用」。
 *
 *          **默认上板。** 它是内置环的替代品，而内置环原本默认显示；若默认不上板，使用者装完只会看到
 *          概览页少了两枚环，得自己去编辑态找回来。
 *
 *          **两个数取自两个来源，各取所长。** 整机数走本包的 node 侧（`os.cpus()` 作差），本进程数走
 *          内核既有的 `/api/overview` —— 后者内核本就在算，再采一遍就是同一事实的第二个来源，而两处
 *          采样时刻不同必然给出两个数。
 *
 *          首次请求时整机 CPU **没有数**（要两个采样点才作得出差），此时环心是破折号而非 0% ——
 *          0% 会被读成「机器闲着」。本进程那段同理，缺则不画。
 */
import { gaugeCard, ring, useHardware, useOverview } from "./lib/store.js"

export default {
  id: "hardware.cpu",
  page: "overview",
  title: "CPU",
  defaultLayout: { w: 3, h: 3, minW: 2, minH: 3, resizable: true },

  /**
   * 建立组件状态
   * @param {object} api 注入的面板能力
   * @returns {Function} 渲染函数
   */
  setup(api) {
    const { data, error } = useHardware(api)
    const overview = useOverview(api)

    /*
     * 环下的一行小字：两段颜色的图例，其后是型号
     *
     * **必须点明「整机」二字。** 初版只写「其中本进程 0%」，而环心那个数没有任何
     * 文字说明它是谁 —— 一枚双色环上，读者要先知道大的那一段是整机、亮的那一小段
     * 是本进程，才看得懂这枚环。「其中」这个词假定读者已经知道了前半句。
     */
    const note = api.computed(() => {
      if (error.value !== "") return `更新失败：${error.value}`
      const own = overview.data.value?.usage?.cpu
      const head = own === undefined ? "整机占用" : `整机占用，其中本进程 ${api.fmt.percent(own)}`
      const models = data.value?.models
      if (models?.cpu === undefined) return head
      const cores =
        models.physicalCores === undefined
          ? `${models.cores ?? "?"} 线程`
          : `${models.physicalCores} 核 ${models.cores} 线程`
      return `${head} · ${models.cpu} · ${cores}`
    })

    return () =>
      gaugeCard(
        api,
        ring(api, "CPU", data.value?.cpu, overview.data.value?.usage?.cpu, note.value)
      )
  }
}
