/**
 * 模块职责：双色环的几何 —— 同一枚环上「整机占用」与「本进程占用」两段弧的取值
 * 依赖方向：无依赖，全为纯函数。**浏览器侧也 import 本模块的编译产物**（`dist/rings.js`）
 * 生命周期：模块级常量与纯函数
 * 注意事项：**这份几何为什么在 `src/` 而不在 `widgets/`。** 本包的 `widgets/*.js` 是浏览器侧的裸 js，
 *          不在任何用例覆盖之内；而两段弧的 dasharray 算错**不报错**，只表现为「环画得不对」——
 *          故几何写成 TypeScript 放 `src/` 由 vitest 钉住，浏览器侧 import 它的编译产物。
 *          这条路走得通的前提是本模块**不 import 任何东西** —— 一旦引了 `node:` 内置模块或 `si`，
 *          浏览器那侧就会在 import 时报错。这是硬约束，不可放宽。
 *
 *          **两段弧是包含关系，不是并列关系。** 本进程占用本就算在整机占用里，故两段首尾相接铺在
 *          同一圈上：自 12 点起先画本进程，其后接「整机减本进程」，两段合起来恰是整机占用。画成两个
 *          各自从 12 点起的独立环是错的 —— 那读起来像两件不相干的事各占一圈。
 *
 *          **本进程那一段夹在整机之内。** 两个数来自两个接口、两个采样时刻，故可能出现「本进程 5%、
 *          整机 3%」这种瞬时矛盾。不夹的话本进程那段会伸出整机弧之外，看起来像「机器人用得比整台
 *          机器还多」。夹住的代价是那一刻偏小，而它下一拍自行修正。
 */

/** 环的半径，与 viewBox 一同定死；两者须配对使用。取值与面板内置的环一致 */
export const RING_RADIUS = 42

/** 环所在的 viewBox 边长 */
export const RING_VIEWBOX = 100

/** 环的周长 */
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** 一段弧的画法 */
export interface RingArc {
  /** `stroke-dasharray` 的取值，形如 `82.90 181.00` */
  readonly dash: string
  /**
   * `stroke-dashoffset` 的取值
   *
   * 一律为非负数。要让一段弧自路径上距起点 `d` 处开始，本可写 `-d`；此处改用
   * `C - d`（两者相差一个整周期，等效），只因负的 dashoffset 在个别旧版浏览器上
   * 会被当作 0 —— 那时两段弧会叠在一处，而这个错在视觉上恰好像「本进程占满了」。
   */
  readonly offset: string
}

/** 双色环的两段弧 */
export interface DualRing {
  /** 本进程那一段，自 12 点起 */
  readonly own: RingArc
  /** 整机余下那一段，接在本进程之后 */
  readonly rest: RingArc
  /** 夹紧之后的本进程比例（0-1）；算不出时 undefined */
  readonly ownRatio: number | undefined
  /** 整机比例（0-1）；算不出时 undefined */
  readonly totalRatio: number | undefined
}

/**
 * 把一个可能不是数的值收进 0-1
 * @param value 待收拢的值
 * @returns 落在 0-1 内的比例；不是有限数时 undefined
 */
function clamp01(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

/**
 * 一段弧的 dasharray 与 dashoffset
 *
 * **后一段由已取整的前一段算出，两段不各自取整** —— 与面板内置的 `ringDash` 同一理由：
 * 各自取整时两段之和不再等于周长，dash 图案便会重复，表现为环上多出一道发丝般的弧。
 * @param length 这段弧有多长（路径长度）
 * @param from 自路径上何处起画
 * @returns 一段弧的画法
 */
function arcOf(length: number, from: number): RingArc {
  const filled = Number(length.toFixed(2))
  const offset = Number((RING_CIRCUMFERENCE - from).toFixed(2))
  return {
    dash: `${filled.toFixed(2)} ${(RING_CIRCUMFERENCE - filled).toFixed(2)}`,
    offset: offset.toFixed(2)
  }
}

/**
 * 算出双色环的两段弧
 *
 * 两段首尾相接：自 12 点起先是本进程那一段，其后接着画到整机占用为止。见文件头。
 * @param total 整机占用（0-1）；测不到时 undefined
 * @param own 本进程占用（0-1）；测不到时 undefined
 * @returns 两段弧与夹紧后的两个比例
 */
export function dualRing(total: number | undefined, own: number | undefined): DualRing {
  const totalRatio = clamp01(total)
  const rawOwn = clamp01(own)

  /*
   * 本进程那一段夹在整机之内，见文件头
   *
   * 整机测不到（首次采样无差可作）而本进程有数时，**本进程那一段照常画** ——
   * 此时它不是「整机的一部分」而是唯一已知的那部分，画出来比空着一圈有用。
   */
  const ownRatio = rawOwn === undefined ? undefined : totalRatio === undefined ? rawOwn : Math.min(rawOwn, totalRatio)

  const ownLen = RING_CIRCUMFERENCE * (ownRatio ?? 0)
  const restLen = RING_CIRCUMFERENCE * Math.max((totalRatio ?? 0) - (ownRatio ?? 0), 0)

  return {
    own: arcOf(ownLen, 0),
    rest: arcOf(restLen, ownLen),
    ownRatio,
    totalRatio
  }
}
