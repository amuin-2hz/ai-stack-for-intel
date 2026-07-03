# Amuin AI Stack

Amuin AI Stack 是一套面向 Linux Intel 设备的本地 AI 运行栈。它把桌面管理台、模型管理、OpenAI 兼容 API 和多模态推理引擎组合在一起，让个人电脑或边缘工作站可以在本机运行对话、视觉理解、语音识别和语音合成能力。

这个项目的重点不是再封装一个云端客户端，而是把模型、运行时、设备调度和使用入口尽量放回本地。用户可以通过桌面应用管理模型和引擎，也可以通过 HTTP API 把本地能力接入现有工具链。

## 核心能力

- **本地多模态推理**：支持 Chat、Vision、ASR、TTS 四类推理引擎，覆盖文本、图像、音频输入与语音输出。
- **Intel 硬件加速优先**：面向 Intel Core Ultra、Intel GPU 和 Intel NPU 设计，基于 OpenVINO 运行已转换模型。
- **桌面化管理体验**：提供 Electron + Vue 管理台，用于查看模型、启动或停止引擎、管理下载任务和观察运行状态。
- **OpenAI 兼容接口**：提供常见 `/v1` API 入口，方便把本地模型接入已有应用、脚本或开发工具。
- **离线与私有化部署**：模型文件、运行日志和推理请求保留在本机，适合需要低延迟、本地数据处理或弱联网环境的场景。

## 适用场景

- 在 Linux Intel 笔记本、迷你主机或工作站上运行本地 AI 助手。
- 为桌面应用、自动化脚本或内部工具提供本机 OpenAI 兼容接口。
- 验证 OpenVINO 模型在 GPU / NPU / CPU 上的运行效果。
- 构建不依赖云端推理服务的语音、视觉和文本处理工作流。

## 技术组成

```text
Electron 桌面壳
  └─ Vue 管理台
      └─ Node.js API 服务
          ├─ 模型与任务管理
          ├─ OpenAI 兼容 API
          └─ Python 推理引擎
              ├─ Chat
              ├─ Vision
              ├─ ASR
              └─ TTS
```

主要目录：

| 路径 | 说明 |
| --- | --- |
| `src/main/` | Electron 主进程 |
| `src/frontend/` | Vue 管理台 |
| `src/api/` | Node.js API 服务 |
| `src/inference/` | Python 推理引擎 |
| `configs/` | 模型清单与设备策略 |
| `ops/scripts/` | 模型下载和运维脚本 |
| `.docs/` | 本地开发、安装、发布等项目说明 |

## 平台定位

当前版本面向 Linux Intel 平台，发布形态以 `.deb` 安装包为主。模型权重默认不打入安装包，用户可以通过管理台或脚本下载到本机模型目录。

推荐环境：

| 项目 | 建议 |
| --- | --- |
| 系统 | Ubuntu 22.04 / 24.04 或 Debian 系发行版 |
| CPU | Intel Core Ultra / x86_64 |
| 内存 | 16 GB 起，32 GB 或以上更合适 |
| 加速 | Intel GPU / NPU 驱动与 OpenVINO 运行环境 |
| 基础依赖 | `python3`, `nodejs`, `ffmpeg`, `sox` |

## 项目状态

当前目标是交付 Linux Intel 版的本地 AI 桌面运行栈，并提供可发布的 `.deb` 包。已覆盖模型管理、四类推理引擎、管理台、下载任务和 OpenAI 兼容接口等主路径。

更细的本地运行、源码启动、打包发布和 API 验证说明放在 [.docs/local-project.md](.docs/local-project.md)。

## 许可证

MIT
