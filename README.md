# Amuin AI Stack

> Local multimodal AI desktop runtime for Linux Intel devices — chat, vision, speech, embeddings & rerank, all on-device.
>
> 面向 Linux Intel 设备的本地多模态 AI 桌面运行栈 —— 在本机运行对话、视觉、语音、向量与重排。

Amuin AI Stack bundles a desktop manager, model management, an OpenAI-compatible API and OpenVINO inference engines into a single `.deb` package. It runs chat, vision understanding, speech recognition, speech synthesis, text embeddings and text reranking entirely on your machine.

Amuin AI Stack 将桌面管理台、模型管理、OpenAI 兼容 API 与 OpenVINO 推理引擎整合在一个 `.deb` 安装包中，可在本机运行对话、视觉理解、语音识别、语音合成、文本向量和文本重排能力。

The current release targets Intel Core Ultra platforms and `amd64` Linux. Model weights are not bundled; after installing, download them on demand from the manager console.

当前发布面向 Intel Core Ultra 平台和 `amd64` Linux。模型权重不包含在安装包中，安装后可在管理台中按需下载和启动。

## Why Amuin AI Stack · 为什么用

Laptop CPU, RAM and disk are precious, and cloud AI adds latency and privacy risk. Amuin AI Stack is built for Intel Core Ultra laptops that carry an NPU and integrated GPU: it places each model on the best accelerator automatically — speech recognition and embeddings on the NPU, chat and vision on the GPU, speech synthesis on the CPU — so the NPU, GPU and CPU are actually used, instead of everything hammering the CPU.

笔记本的 CPU、内存和磁盘都很紧张，云端 AI 又有延迟和隐私成本。Amuin AI Stack 专为 Intel Core Ultra 这类自带 NPU 和核显的笔记本设计：自动把每个模型放到最合适的加速器——语音识别和文本向量跑 NPU，对话和视觉跑 GPU，语音合成跑 CPU——把 NPU、GPU、CPU 都真正用起来，而不是只让 CPU 硬扛。

In minutes, you get a turnkey local AI environment on your own Intel laptop: text-to-text (chat), image-to-text (vision), speech recognition, text-to-speech, text embeddings and text reranking — all running locally, with nothing uploaded.

装好后，在你自己的 Intel 笔记本上几分钟就能跑通一套开箱即用的本地 AI 环境：文生文（对话）、图生文（视觉理解）、语音识别、文生语音、文本向量和文本重排，全程本机运行、不上传数据。

## Capabilities · 主要能力

| Capability · 能力 | API | Default device · 默认设备 |
| --- | --- | --- |
| Chat · 文本对话 | `POST /v1/chat/completions` | GPU |
| Vision · 视觉理解 | `POST /v1/chat/completions` | GPU |
| Speech recognition · 语音识别 | `POST /v1/audio/transcriptions` | NPU + CPU |
| Speech synthesis · 语音合成 | `POST /v1/audio/speech` | CPU |
| Embeddings · 文本向量 | `POST /v1/embeddings` | NPU |
| Rerank · 文本重排 | `POST /v1/rerank` | GPU |

- Electron + Vue desktop manager · Electron + Vue 桌面管理台
- Local model download, discovery, start/stop and status · 本地模型下载、识别、启动、停止和运行状态管理
- OpenAI-style local HTTP API · OpenAI 风格的本地 HTTP API
- Intel GPU / NPU / CPU device scheduling with fallback · Intel GPU、NPU 和 CPU 设备调度及回退
- Models, requests and logs stay on-device · 模型、请求和日志默认保留在本机

## Release Package · 发布包

Each release ships three files:

每个版本提供以下三个文件：

```text
amuin-ai-stack_0.2.0_amd64.deb
SHA256SUMS
RELEASE_NOTES.md
```

The `.deb` bundles the desktop app, the management API and the Python inference entrypoints — no model weights. The package is ~100 MB; downloaded models need extra disk space.

`.deb` 包含桌面应用、管理 API 和 Python 推理入口，不包含模型权重。安装包约 100 MB；模型下载后需要额外磁盘空间。

## System Requirements · 系统要求

| Item · 项目 | Requirement · 要求 |
| --- | --- |
| OS · 操作系统 | Ubuntu 22.04 / 24.04 or compatible Debian-based distro · Ubuntu 22.04 / 24.04 或兼容的 Debian 系发行版 |
| Arch · 架构 | `amd64` / `x86_64` |
| CPU | Intel Core Ultra; other x86_64 CPUs use CPU fallback · Intel Core Ultra，其他 x86_64 CPU 可使用 CPU 回退 |
| RAM · 内存 | 16 GB min, 32 GB recommended · 最低 16 GB，推荐 32 GB |
| Disk · 磁盘 | ~350 MB for the app; 30 GB+ for models · 应用约 350 MB；模型建议预留 30 GB 以上 |
| Acceleration · 加速 | Intel GPU / NPU drivers, OpenVINO 2026.2.1 |
| Base · 基础组件 | Python 3, Node.js, FFmpeg, SoX |

Verified on Intel Core Ultra 7 258V with Intel Graphics and Intel AI Boost NPU. Without a compatible NPU or GPU, some engines fall back to CPU (slower).

已验证硬件为 Intel Core Ultra 7 258V、Intel Graphics 和 Intel AI Boost NPU。没有兼容 NPU 或 GPU 时，部分引擎可以回退到 CPU，但性能会明显下降。

## Install · 安装

Put the `.deb`, `SHA256SUMS` and `RELEASE_NOTES.md` in the same directory.

将 `.deb`、`SHA256SUMS` 和 `RELEASE_NOTES.md` 放在同一目录。

1. Verify the package:

校验安装包：

```bash
sha256sum -c SHA256SUMS
```

2. Install:

安装应用：

```bash
sudo apt install ./amuin-ai-stack_0.2.0_amd64.deb
```

3. Prepare the OpenVINO runtime as a normal user:

以普通用户身份准备 OpenVINO 运行环境：

```bash
/opt/amuin-ai-stack/ops/scripts/setup-runtime.sh
```

This installs a pinned OpenVINO 2026.2.1 runtime into your user data directory without touching the system Python. For Qwen3-TTS, add `--with-tts`:

该脚本会在用户数据目录中安装固定版本的 OpenVINO 2026.2.1 运行组件，不修改系统 Python。需要使用 Qwen3-TTS 时执行：

```bash
/opt/amuin-ai-stack/ops/scripts/setup-runtime.sh --with-tts
```

4. Launch from the desktop menu, or from a terminal:

从桌面应用菜单启动，或在终端运行：

```bash
amuin-ai-stack
```

On first launch, download models from the **Models** page, then pick a model and device on the **Engines** page and start a service.

首次启动后，在“模型”页面下载模型，再到“引擎”页面选择模型和设备并启动服务。

### Prepare Models After Install · 安装后准备模型

After installing the `.deb` and running `setup-runtime.sh` once, ordinary OpenVINO models just need to be placed as a complete directory under your user model directory:

安装 `.deb` 并执行一次 `setup-runtime.sh` 后，普通 OpenVINO 模型只需要以完整目录形式放入当前用户的模型目录：

```text
~/.local/share/amuin-ai-stack/models/<model-dir>/
```

For example · 例如：

```text
~/.local/share/amuin-ai-stack/models/Qwen3.5-4B-fp16-ov/
~/.local/share/amuin-ai-stack/models/Qwen3-Embedding-0.6B-fp16-ov/
```

The model directory must contain the complete set of files from the upstream repository — config, tokenizer, chat template, and the OpenVINO `.xml` / `.bin` files — not just a single weight file. The app auto-scans these directories on launch; you can also download models directly from the manager console without copying anything manually.

模型目录需要包含上游仓库提供的完整文件，例如配置、Tokenizer、聊天模板以及 OpenVINO `.xml`/`.bin` 文件，不能只复制单个权重文件。应用启动后会自动扫描这些目录；也可以直接在管理台下载模型，无需手动复制。

Extra setup per feature · 按使用内容的额外要求：

| Feature · 使用内容 | Extra step · 额外操作 |
| --- | --- |
| Chat, Vision, ASR-0.6B, Embedding, Rerank | Run `setup-runtime.sh` once, then download the model · 执行一次 `setup-runtime.sh`，然后下载对应模型 |
| Qwen3-ASR-1.7B | Also run `setup-qwen3-asr-runtime.sh` · 另外执行 `setup-qwen3-asr-runtime.sh` |
| Qwen3-TTS | Install extra deps via `setup-runtime.sh --with-tts` · 使用 `setup-runtime.sh --with-tts` 安装额外依赖 |
| GPU / NPU acceleration | Install the matching Intel drivers and firmware first · 主机需要提前安装相应的 Intel 驱动和固件 |

The `.deb` does not bundle model weights, nor does it install Intel kernel drivers or NPU firmware.

`.deb` 不包含模型权重，也不会安装 Intel 内核驱动或 NPU 固件。

## Data Directory · 数据目录

User data is stored by default at:

用户数据默认保存在：

```text
~/.local/share/amuin-ai-stack/
├── models/       model weights · 模型权重
├── state/        app state and database · 应用状态和数据库
├── logs/         runtime logs · 运行日志
├── runtime/      OpenVINO Python runtime · OpenVINO Python 运行环境
└── qwen3-asr/    Qwen3-ASR-1.7B isolated runtime · Qwen3-ASR-1.7B 隔离运行环境
```

Set `AI_STACK_DATA_HOME` before launch to change the root directory.

可在启动前通过 `AI_STACK_DATA_HOME` 修改根目录。

## Models & Devices · 模型与设备

| Capability · 能力 | Model · 模型 | Format · 格式 | Device · 推荐设备 | Status · 状态 |
| --- | --- | --- | --- | --- |
| Chat · 对话 | Qwen3.5-2B | OpenVINO FP16 | GPU | Verified · 已验证 |
| Vision · 视觉理解 | Qwen3-VL-4B-Instruct | OpenVINO INT4 | GPU | Verified · 已验证 |
| ASR · 语音识别 | Qwen3-ASR-0.6B | OpenVINO INT8 | NPU + CPU | Verified · 已验证 |
| TTS · 语音合成 | Qwen3-TTS-0.6B CustomVoice | PyTorch | CPU | Verified · 已验证 |
| Chat (optional) · 对话可选 | Qwen3.5-4B | OpenVINO FP16 | GPU | Verified · 已验证 |
| ASR (optional) · 语音识别可选 | Qwen3-ASR-1.7B | OpenVINO INT8 | GPU / CPU | Verified · 已验证 |
| Embedding · 文本向量 | Qwen3-Embedding-0.6B | OpenVINO FP16 | NPU | Verified · 已验证 |
| Rerank · 文本重排 | Qwen3-Reranker-0.6B | OpenVINO FP16 | GPU | Verified · 已验证 |

Qwen3-ASR-1.7B needs an extra setup step before first use · Qwen3-ASR-1.7B 首次使用前还需要执行：

```bash
/opt/amuin-ai-stack/ops/scripts/setup-qwen3-asr-runtime.sh
```

ASR-1.7B cannot currently compile on NPU; the manager prefers the GPU and falls back to CPU.

ASR-1.7B 当前无法在 NPU 上编译，管理台会优先使用 GPU，并在 GPU 不可用时回退到 CPU。

## Model Download Sources · 模型下载来源

Public download sources for the default models. After installing, paste the repo URL into the **Models** page to download, or download manually with the CLI and drop it into the model directory.

以下为各引擎默认模型的公开下载源。安装后可在管理台「模型」页粘贴对应的仓库链接直接下载，或用命令行工具手动下载后放入模型目录。

| Capability · 能力 | Model · 模型 | Repo ID | Platform · 平台 |
| --- | --- | --- | --- |
| Chat · 对话 | Qwen3.5-2B | `amuin02hz/Qwen3.5-2B-OpenVINO-FP16` | ModelScope |
| Vision · 视觉理解 | Qwen3-VL-4B-Instruct | `Echo9Zulu/Qwen3-VL-4B-Instruct-int4_asym-ov` | Hugging Face |
| ASR · 语音识别 | Qwen3-ASR-0.6B | `Echo9Zulu/Qwen3-ASR-0.6B-INT8_ASYM-OpenVINO` | Hugging Face |
| TTS · 语音合成 | Qwen3-TTS-0.6B | `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` | Hugging Face |
| Chat (optional) · 对话可选 | Qwen3.5-4B | `OpenVINO/Qwen3.5-4B-fp16-ov` | Hugging Face |
| ASR (optional) · 语音识别可选 | Qwen3-ASR-1.7B | `jinhwan000/qwen3-asr-1.7b-ov-int8` | Hugging Face |
| Embedding · 文本向量 | Qwen3-Embedding-0.6B | `OpenVINO/Qwen3-Embedding-0.6B-fp16-ov` | Hugging Face |
| Rerank · 文本重排 | Qwen3-Reranker-0.6B | `OpenVINO/Qwen3-Reranker-0.6B-fp16-ov` | Hugging Face |

Paste the full URL when importing on the **Models** page:

在管理台「模型」页导入下载时，粘贴完整链接：

```text
Hugging Face：  https://huggingface.co/<repo_id>
ModelScope：   https://modelscope.cn/models/<repo_id>
```

Or download manually and place it in the model directory · 也可以手动下载后放入模型目录：

```bash
# Hugging Face
huggingface-cli download Echo9Zulu/Qwen3-ASR-0.6B-INT8_ASYM-OpenVINO \
  --local-dir ~/.local/share/amuin-ai-stack/models/<model-dir>

# ModelScope
modelscope download --model amuin02hz/Qwen3.5-2B-OpenVINO-FP16 \
  --local_dir ~/.local/share/amuin-ai-stack/models/<model-dir>
```

The directory name is arbitrary — the app auto-detects it on launch. Just make sure it contains the complete upstream files (config, tokenizer, chat template, and OpenVINO `.xml` / `.bin`).

模型目录名可自定义，应用启动后会自动扫描识别；只需保证目录内包含上游仓库提供的完整文件（配置、Tokenizer、聊天模板以及 OpenVINO `.xml`/`.bin` 等）。

## API Usage · API 使用

The API listens on `127.0.0.1:8000` only. Start the relevant engine in the manager console first.

API 默认只监听 `127.0.0.1:8000`。先在管理台启动相应引擎，再调用接口。

List running models · 列出正在运行的模型：

```bash
curl http://127.0.0.1:8000/v1/models
```

Chat · 文本对话：

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen3.5-2B-fp16-ov",
    "messages": [{"role": "user", "content": "你好，请介绍一下你自己。"}]
  }'
```

Embeddings · 文本向量：

```bash
curl http://127.0.0.1:8000/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen3-Embedding-0.6B-fp16-ov","input":"本地 AI 推理"}'
```

Speech recognition · 语音识别：

```bash
curl http://127.0.0.1:8000/v1/audio/transcriptions \
  -F 'model=Qwen3-ASR-0.6B-int8-ov' \
  -F 'file=@sample.wav'
```

## Update & Uninstall · 更新与卸载

Installing a new version keeps models, state and logs in your user directory:

安装新版本会保留用户目录中的模型、状态和日志：

```bash
sudo apt install ./amuin-ai-stack_NEW_VERSION_amd64.deb
```

Uninstall · 卸载应用：

```bash
sudo apt remove amuin-ai-stack
```

To also remove models and runtime data, delete them manually after confirming they are no longer needed:

如需同时删除模型和运行数据，可在确认无用后手动删除：

```bash
rm -rf ~/.local/share/amuin-ai-stack
```

## Known Limitations · 已知限制

- Currently ships `amd64` Debian packages only · 当前仅发布 `amd64` Debian 安装包。
- Model weights must be downloaded separately after install · 模型权重需要安装后单独下载。
- NPU features depend on host drivers and firmware, not just the package · NPU 功能依赖主机驱动和固件，不能仅靠安装包提供。
- Qwen3-ASR-1.7B and Qwen3-Reranker-0.6B dynamic graphs are not NPU-suitable yet and default to GPU · Qwen3-ASR-1.7B 和 Qwen3-Reranker-0.6B 的动态模型图目前不适合 NPU，默认运行在 GPU。
- The TTS runtime is large, so it is installed separately via `--with-tts` · TTS 运行环境体积较大，因此通过 `--with-tts` 单独安装。
- The local API has no authentication by default; do not expose the port to untrusted networks · 本地 API 默认没有鉴权，请勿将端口直接暴露到不可信网络。

## Troubleshooting · 故障排查

Check OpenVINO and devices · 检查 OpenVINO 和设备：

```bash
~/.local/share/amuin-ai-stack/runtime/bin/python -c \
  'import openvino as ov; print(ov.__version__); print(ov.Core().available_devices)'
```

Launch the app in the foreground to see errors directly · 前台启动应用可直接查看错误输出：

```bash
amuin-ai-stack
```

Logs are under `~/.local/share/amuin-ai-stack/logs/`. If the NPU is not visible, confirm `/dev/accel/accel0` exists and that your user is in the `render` group.

运行日志位于 `~/.local/share/amuin-ai-stack/logs/`。如果 NPU 不可见，请先确认 `/dev/accel/accel0` 存在，并检查当前用户是否属于 `render` 组。

## Privacy & Security · 隐私与安全

Inference requests, models and logs stay on-device by default. The app only serves the management API on the loopback address and does not upload conversations or audio. Model downloads hit only the Hugging Face or ModelScope repos you choose.

推理请求、模型和日志默认保存在本机。应用只在回环地址提供管理 API，不主动上传对话或音频内容。模型下载会访问用户选择的 Hugging Face 或 ModelScope 仓库。

Only download the package from a trusted release page and verify `SHA256SUMS` before installing.

请仅从可信发布页下载安装包，并在安装前核对 `SHA256SUMS`。

## License · 许可证

The application code is MIT-licensed; see the bundled `LICENSE`. Model weights follow each model repo's own license and terms of use.

应用代码采用 MIT License，详见随包的 `LICENSE`。模型权重遵循各模型仓库自身的许可证和使用条款。

`src/inference/qwen_3_asr_helper.py` is vendored from OpenVINO Notebooks at pinned commit `69b0f57`, licensed under Apache-2.0.

`src/inference/qwen_3_asr_helper.py` 来源于 OpenVINO Notebooks 固定提交 `69b0f57`，遵循 Apache-2.0 许可证。
