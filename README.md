# hardware-plugin

Yunzai NG 的硬件信息插件：整机 CPU、内存与各显卡占用，兼作**面板插件的示例**。

本仓库是 [Yunzai NG](https://github.com/Yunzai-NG/yunzai-ng) 的官方可选插件，不随内核分发。
插件名为 `hardware`（目录名为 `hardware-plugin`）。

## 它做什么

装上并重载面板之后，概览页的「添加组件」里会多出十枚组件：**系统**、**CPU**、**内存**、
**交换空间**、**显卡**、**磁盘**、**网络**、**进程**、**系统信息**、**Redis**。

其中**只有「系统」默认上板**，余下九枚出现在编辑态的「已移除」一栏里。装一个插件不该重排
任何人已排好的版面，而十枚一齐上板等于把概览页整个换掉。

「系统」那一枚把 CPU 与内存合在一张卡上说：左侧是型号、核数、总量、使用量这类一眼扫完的
事实，右侧两枚环各带三段图例 —— **Yunzai NG 占用 / 其他占用 / 空闲**，三行加起来恰是
100%。「其他占用」没有任何接口直接给，它是整机减本进程算出来的。

CPU 与内存那两枚单环仍在包里，给「只想要一枚环、不要那张事实表」的人。**它们与「系统」
不该同时上板** —— 同一份采样在一页上出现两次，读者只会怀疑哪一个是错的。

数据也可直接取用：`GET /plugin/hardware/hardware`（照常鉴权）。

## 为什么它不在内核里

`systeminformation` 是 858 KB / 27 个文件，而它换来的东西对一台只跑机器人的服务器并非必需。
内核只用 `node:os` 与 `nvidia-smi` 能拿到的那些，想要更细的由本插件补上。

## 两半

面板插件是**浏览器侧的 ESM**，碰不到 `statfs` 与 `nvidia-smi`，故本插件分两半：

```
src/index.ts             node 侧：注册 GET /plugin/hardware/hardware 等端点
src/probe.ts             型号探测（只探一次）与占用采样
src/rings.ts             双色环与三段图例的几何，由 vitest 钉住
index.js                 面板侧入口：把十枚组件汇总成一个数组
widgets/hardware-*.js    十枚组件，手写 ESM，不经构建
widgets/lib/store.js     十枚共用的取数、画环与画表
style.css                本包自带的样式表，由 webuiPanel.style 声明
```

浏览器入口固定是包根的 `index.js`，其余靠相对路径由它自己引 —— 整个包目录都是静态可取的。
写法见[面板插件](https://yunzai-ng.github.io/panel-plugin)，本包这几个文件即是带注释的
完整示例。

**几何写在 `src/` 而不是 `widgets/`。** 两段弧的 dasharray 算错**不报错**，只表现为「环画得
不对」，故它写成 TypeScript 由用例钉住，浏览器侧 import 编译产物（`dist/rings.js`）。这条路
走得通的前提是 `src/rings.ts` **不 import 任何东西** —— 一旦引了 `node:` 内置模块或 `si`，
浏览器那侧就会在 import 时报错。

**`.legend-*`、`.sys-*` 与 `.ring-own` 这些类名在面板样式表里没有**，故本包自带一份
`style.css`。面板会把其中每条选择器限定到本包之后才注入，改不到面板别处；但 `@keyframes`
的名字是全局的，若要写动画须自加前缀。

## 取数口径

- **CPU** 取 `os.cpus()` 各核时间累计量作差，不用 `si.currentLoad()`（后者 511ms 且每次起
  子进程）。首次采样无差可作，此时该值**不出现**而非记 0 —— 0 会被读成「机器闲着」
- **内存** 取 `totalmem() - freemem()`，与任务管理器同源
- **显卡** 两路合并：`nvidia-smi` 管占用率（复用内核的 `probeGpus()`，不另写一份解析 ——
  两份解析迟早会对同一块卡给出两个数），`si.graphics()` 管型号与集显。集显有型号而无占用率，
  故槽为空而非 0%。虚拟显示器（ToDesk、GameViewer 一类）按名字排掉
- **型号**（CPU 型号、内存规格）只探一次：`si.cpu()` 2131ms、`si.graphics()` 2250ms、
  `si.memLayout()` 683ms，且均不缓存。首次请求**不等**它探完，型号在下一轮出现

## 安装

推荐经面板的插件市场安装：面板 → 插件市场 → 搜索 `hardware-plugin` → 安装。

亦可手工克隆至主目录的 `plugins/` 下：

```powershell
cd <主目录>\plugins
git clone https://github.com/Yunzai-NG/hardware-plugin.git
cd hardware-plugin
pnpm install
pnpm run build
```

装好后重载面板（刷新页面即可，组件清单在页面加载时扫一次）。

## 开发

本插件依赖 `@yunzai-ng/core` 与 `@yunzai-ng/types`，两者声明为 `peerDependencies`
（运行期由宿主内核提供，插件目录内不应再装一份）。**框架发布至 npm 之前**，需先链接本地
框架 checkout：

```powershell
git clone https://github.com/Yunzai-NG/yunzai-ng.git
cd yunzai-ng
pnpm install
pnpm run build          # 必需：本插件的 tsc 读取框架的 dist/*.d.ts

cd ..\hardware-plugin
pnpm install
pnpm run link:framework # 在 node_modules/@yunzai-ng 下建立指向框架的链接
pnpm run verify         # build → typecheck:test → lint → test
```

`link:framework` 按 `YZNG_FRAMEWORK` 环境变量 → `../yunzai-ng` → `../../yunzai-ng` →
`../../code` 的顺序查找框架仓库。目录布局与上述不同时设置该环境变量即可。

框架发布之后，`pnpm install` 即可满足依赖，该步骤不再必需。

`widgets/` 下的 js 不经构建，也**不能 import 裸包名** —— 浏览器按 URL 解析模块说明符，
`import si from "systeminformation"` 在那里是一条网络错误。要用的能力一概经注入的 `api` 取；
同目录的相对路径（如 `./lib/store.js`）是 URL，故可以引。

## 许可

AGPL-3.0-or-later
