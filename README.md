# hardware-plugin

Yunzai NG 的硬件信息插件：整机 CPU、内存与各显卡占用，兼作**面板插件的示例**。

本仓库是 [Yunzai NG](https://github.com/Yunzai-NG/yunzai-ng) 的官方可选插件，不随内核分发。
插件名为 `hardware`（目录名为 `hardware-plugin`）。

## 它做什么

装上并重载面板之后，概览页的「添加组件」里会多出三枚组件：**CPU（全机）**、
**内存（全机）**、**显卡（全机）**，各是一条或几条线性槽。

内置的 CPU / 内存两枚环取的是**本进程**的占用，本插件取的是**整机**。两者并存而不互相
取代 —— 取代等于让一个插件装没装改变默认版面。故本插件的标题一律带「（全机）」后缀，卡片
下方另写明取数口径。

三枚里 CPU 与显卡**默认不上板**（只出现在编辑态的「已移除」一栏）：装一个插件不该改动任何人
已排好的版面，而多数机器上显卡占用率根本测不到（`nvidia-smi` 只在 N 卡上有）。

数据也可直接取用：`GET /plugin/hardware/hardware`（照常鉴权）。

## 为什么它不在内核里

`systeminformation` 是 858 KB / 27 个文件，而它换来的东西对一台只跑机器人的服务器并非必需。
内核只用 `node:os` 与 `nvidia-smi` 能拿到的那些，想要更细的由本插件补上。

## 两半

面板插件是**浏览器侧的 ESM**，碰不到 `statfs` 与 `nvidia-smi`，故本插件分两半：

```
src/index.ts             node 侧：注册 GET /plugin/hardware/hardware
src/probe.ts             型号探测（只探一次）与占用采样
panel/hardware-cpu.js    面板侧：三枚组件，手写 ESM，不经构建
panel/hardware-memory.js
panel/hardware-gpu.js
panel/lib/store.js       三枚共用的取数与画槽
```

`panel/` 下的 js **无须复制到任何地方** —— 面板会扫每个已装插件的 `panel/` 目录。写法见
[面板插件](https://github.com/Yunzai-NG/yunzai-ng/blob/main/docs/panel-plugin.md)，本仓库这
三个文件即是带注释的完整示例。

**只有 `panel/` 的顶层 js 被当作组件，子目录不扫**，而静态挂载是整个目录树 —— 于是
`lib/` 正好用来放三枚共用的代码：取得到，却不会被误当成第四枚组件。三枚各自订阅节拍，
但同一拍里的三次取数由 `lib/store.js` 收敛成一次请求。

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

`panel/` 下的 js 不经构建，也**不能 import 裸包名** —— 浏览器按 URL 解析模块说明符，
`import si from "systeminformation"` 在那里是一条网络错误。要用的能力一概经注入的 `api` 取；
同目录的相对路径（如 `./lib/store.js`）是 URL，故可以引。

## 许可

AGPL-3.0-or-later
