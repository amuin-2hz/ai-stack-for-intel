# Amuin AI Stack 0.2.1

发布日期：2026-08

## 本版修复

- 修复 OpenAI 兼容的 ASR/TTS HTTP 接口与 WebSocket 推理引擎之间的协议桥接。
- 修复 WebSocket 代理重复转发音频帧的问题。
- 修复 NPU Embedding 批量输入失败，批处理不受支持时自动逐条推理。
- 完成 Ubuntu 26.04、OpenVINO 2026.2.1，以及 Intel CPU/GPU/NPU 的运行验证。
- 新增原生 RPM 安装包，面向 Fedora、RHEL 兼容发行版和 openEuler `x86_64`。
- RPM 元数据和依赖解析已通过 Fedora 44、Rocky Linux 10 和 openEuler 24.03 LTS 验证。

## 主要功能

- 提供 Linux Intel `amd64` 桌面管理应用和本地 OpenAI 兼容 API。
- 推理运行时升级到 OpenVINO 2026.2.1 稳定版。
- 支持 Chat、Vision、ASR、TTS、Embedding 和 Rerank 六类引擎。
- 新增 Qwen3.5-4B、Qwen3-VL-4B-Instruct、Qwen3-ASR-1.7B、Qwen3-Embedding-0.6B 和 Qwen3-Reranker-0.6B。
- Qwen3-Embedding-0.6B 默认使用 NPU。
- Qwen3-ASR-0.6B 使用 NPU 音频编码器和 CPU thinker/decoder。
- Qwen3-ASR-1.7B 默认使用 GPU，GPU 不可用时回退到 CPU。

## 安装文件

- `amuin-ai-stack_0.2.1_amd64.deb`
- `amuin-ai-stack-0.2.1-1.x86_64.rpm`
- `SHA256SUMS`
- `RELEASE_NOTES.md`

安装前请运行 `sha256sum -c SHA256SUMS`。

## 注意事项

- 安装包不包含模型权重。
- 首次启动前请运行 `/opt/amuin-ai-stack/ops/scripts/setup-runtime.sh`。
- TTS 依赖需要使用 `setup-runtime.sh --with-tts` 单独安装。
- NPU/GPU 加速依赖主机已正确安装 Intel 驱动和固件。
- 本版同时提供 `amd64` Debian 安装包和 `x86_64` RPM 安装包。
