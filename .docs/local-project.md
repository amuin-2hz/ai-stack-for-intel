# Amuin AI Stack 本地项目说明

这份文档保存原根目录 README 中偏本地开发、安装、调试和发布的说明。根目录 `README.md` 只保留项目介绍与对外说明。

## 项目定位

Amuin AI Stack 是面向 **Linux + Intel Core Ultra / Intel GPU / Intel NPU** 的本地 AI 桌面运行栈。它把 Electron 管理台、Node.js API、Python OpenVINO 推理引擎和模型管理流程放在一个本地应用里，目标是在不依赖云端服务的情况下运行对话、视觉理解、语音识别和语音合成。

当前发布目标：`Amuin-ai-stack` Linux Intel 版，免费使用，可在 GitHub Releases 和 Gitee Releases 发布 `.deb` 安装包。

## 功能

- 本地模型管理：识别 `models/` 下的 OpenVINO IR、PyTorch / HF 权重目录和下载状态。
- 推理引擎管理：Chat、Vision、ASR、TTS 四类引擎可在管理台启动、停止和查看状态。
- OpenAI 兼容接口：提供 `/v1/models`、`/v1/chat/completions`、`/v1/audio/transcriptions`、`/v1/audio/speech`。
- 模型下载任务：支持 ModelScope / Hugging Face 链接解析，并通过后台任务下载到本地模型目录。
- 桌面应用：Electron + Vue 管理台，安装后命令为 `amuin-ai-stack`。

## 硬件与系统要求

| 项目 | 最低建议 | 推荐配置 |
| --- | --- | --- |
| 系统 | Ubuntu 22.04 / Debian 系发行版 | Ubuntu 24.04 或更新 |
| CPU | Intel Core Ultra / x86_64 | Intel Core Ultra 7 / Ultra 9 |
| 内存 | 16 GB | 32 GB 或以上 |
| 加速 | Intel GPU / NPU 驱动 | OpenVINO 2026.2 + NPU 驱动 |
| 依赖 | `python3`, `nodejs`, `ffmpeg`, `sox` | 同左 |

## 安装 deb

```bash
sudo apt install -y python3 nodejs ffmpeg sox
sudo dpkg -i amuin-ai-stack_0.2.0_amd64.deb
sudo apt -f install
amuin-ai-stack
```

安装路径：

- 应用：`/opt/amuin-ai-stack`
- 模型：`/opt/amuin-ai-stack/models`
- 状态：`/opt/amuin-ai-stack/state`
- 日志：`/opt/amuin-ai-stack/logs`

## 从源码运行

```bash
cd localRuntime
npm install
cd src/api && npm install
cd ../frontend && npm install
cd ../..

./scripts/dev-web.sh
```

默认端口：

| 端口 | 服务 |
| --- | --- |
| `8000` | API 服务 |
| `58888` | Vue 管理台开发服务 |
| `31000` | Chat 引擎 |
| `31001` | Vision 引擎 |
| `31002` | ASR 引擎 |
| `31003` | TTS 引擎 |

## 打包 deb

```bash
./scripts/build-deb.sh
```

产物位置：

```text
dist-deb/amuin-ai-stack_0.2.0_amd64.deb
```

说明：deb 默认不内置大模型权重，避免 GitHub/Gitee 发布包过大。模型通过管理台或脚本下载到本机 `models/` 目录。

## 模型下载

管理台「模型库」可以粘贴 ModelScope 或 Hugging Face 链接下载。当前推荐先使用下面已经转换或验证过的 ModelScope 仓库：

| 用途 | 模型 | 格式 | 推荐设备 | ModelScope 链接 |
| --- | --- | --- | --- | --- |
| 对话 | Qwen3.5-2B | OpenVINO FP16 | GPU | https://modelscope.cn/models/amuin/Qwen3.5-2B-fp16-ov |
| 视觉 | Qwen2.5-VL-3B | OpenVINO FP16 | GPU | https://modelscope.cn/models/amuin/Qwen2.5-VL-3B-fp16-ov |
| 语音识别 | Qwen3-ASR-0.6B | OpenVINO INT8 | NPU / CPU | https://modelscope.cn/models/amuin/Qwen3-ASR-0.6B-int8-ov |
| 语音合成 | Qwen3-TTS-0.6B CustomVoice | PyTorch CPU | CPU | https://modelscope.cn/models/amuin/Qwen3-TTS-0.6B-CustomVoice |

也可以手动下载：

```bash
# ModelScope
AI_STACK_BASE=/opt/amuin-ai-stack   /opt/amuin-ai-stack/ops/scripts/ms-download.sh amuin/Qwen3.5-2B-fp16-ov Qwen3.5-2B-fp16-ov

# Hugging Face
AI_STACK_BASE=/opt/amuin-ai-stack   /opt/amuin-ai-stack/ops/scripts/hf-download.sh Qwen/Qwen2.5-VL-3B-Instruct Qwen2.5-VL-3B-Instruct
```

如果用源码运行，把 `AI_STACK_BASE` 指向项目根目录即可。

## API 快速验证

```bash
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/models
curl http://127.0.0.1:8000/engines
```

启动 Chat 引擎后：

```bash
curl -sS http://127.0.0.1:8000/v1/models
curl -sS http://127.0.0.1:8000/v1/chat/completions   -H 'Content-Type: application/json'   -d '{"model":"qwen35-2b","messages":[{"role":"user","content":"你好"}],"stream":false}'
```

## 发布到 GitHub / Gitee

建议 Release 附件：

- `amuin-ai-stack_0.2.0_amd64.deb`
- `SHA256SUMS`
- 根目录 `README.md`

生成校验：

```bash
cd dist-deb
sha256sum amuin-ai-stack_0.2.0_amd64.deb > SHA256SUMS
```

发布说明建议写清：

- 这是 Linux Intel 版。
- deb 不包含大模型权重，模型需按文档下载。
- 首次启动后 API 监听 `127.0.0.1:8000`，引擎按需启动。
- NPU/GPU 能否启用取决于本机 Intel 驱动和 OpenVINO 安装。

## 项目结构

```text
src/main/       Electron 主进程
src/frontend/   Vue 管理台
src/api/        Node.js API 服务
src/inference/  Python 推理引擎脚本
ops/scripts/    ModelScope / Hugging Face 下载脚本
configs/        模型清单和设备策略
models/         本地模型目录，不建议提交到 Git
```

## 许可证

MIT
