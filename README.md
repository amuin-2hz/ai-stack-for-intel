[中文](README.zh.md)

# Amuin AI Stack

> Local multimodal AI desktop runtime for Linux Intel devices — chat, vision, speech, embeddings & rerank, all on-device.

Amuin AI Stack bundles a desktop manager, model management, an OpenAI-compatible API and OpenVINO inference engines into a single `.deb` package. It runs chat, vision understanding, speech recognition, speech synthesis, text embeddings and text reranking entirely on your machine.

The current release targets Intel Core Ultra platforms and `amd64` Linux. Model weights are not bundled; after installing, download them on demand from the manager console.

## Why Amuin AI Stack

Laptop CPU, RAM and disk are precious, and cloud AI adds latency and privacy risk. Amuin AI Stack is built for Intel Core Ultra laptops that carry an NPU and integrated GPU: it places each model on the best accelerator automatically — speech recognition and embeddings on the NPU, chat and vision on the GPU, speech synthesis on the CPU — so the NPU, GPU and CPU are actually used, instead of everything hammering the CPU.

In minutes, you get a turnkey local AI environment on your own Intel laptop: text-to-text (chat), image-to-text (vision), speech recognition, text-to-speech, text embeddings and text reranking — all running locally, with nothing uploaded.

## Capabilities

| Capability | API | Default device |
| --- | --- | --- |
| Chat | `POST /v1/chat/completions` | GPU |
| Vision | `POST /v1/chat/completions` | GPU |
| Speech recognition | `POST /v1/audio/transcriptions` | NPU + CPU |
| Speech synthesis | `POST /v1/audio/speech` | CPU |
| Embeddings | `POST /v1/embeddings` | NPU |
| Rerank | `POST /v1/rerank` | GPU |

- Electron + Vue desktop manager
- Local model download, discovery, start/stop and status
- OpenAI-style local HTTP API
- Intel GPU / NPU / CPU device scheduling with fallback
- Models, requests and logs stay on-device

## Release Package

Each release ships three files:

```text
amuin-ai-stack_0.2.0_amd64.deb
SHA256SUMS
RELEASE_NOTES.md
```

The `.deb` bundles the desktop app, the management API and the Python inference entrypoints — no model weights. The package is ~100 MB; downloaded models need extra disk space.

## System Requirements

| Item | Requirement |
| --- | --- |
| OS | Ubuntu 22.04 / 24.04 or compatible Debian-based distro |
| Arch | `amd64` / `x86_64` |
| CPU | Intel Core Ultra; other x86_64 CPUs use CPU fallback |
| RAM | 16 GB min, 32 GB recommended |
| Disk | ~350 MB for the app; 30 GB+ for models |
| Acceleration | Intel GPU / NPU drivers, OpenVINO 2026.2.1 |
| Base | Python 3, Node.js, FFmpeg, SoX |

Verified on Intel Core Ultra 7 258V with Intel Graphics and Intel AI Boost NPU. Without a compatible NPU or GPU, some engines fall back to CPU (slower).

## Install

Put the `.deb`, `SHA256SUMS` and `RELEASE_NOTES.md` in the same directory.

1. Verify the package:

```bash
sha256sum -c SHA256SUMS
```

2. Install:

```bash
sudo apt install ./amuin-ai-stack_0.2.0_amd64.deb
```

3. Prepare the OpenVINO runtime as a normal user:

```bash
/opt/amuin-ai-stack/ops/scripts/setup-runtime.sh
```

This installs a pinned OpenVINO 2026.2.1 runtime into your user data directory without touching the system Python. For Qwen3-TTS, add `--with-tts`:

```bash
/opt/amuin-ai-stack/ops/scripts/setup-runtime.sh --with-tts
```

4. Launch from the desktop menu, or from a terminal:

```bash
amuin-ai-stack
```

On first launch, download models from the **Models** page, then pick a model and device on the **Engines** page and start a service.

### Prepare Models After Install

After installing the `.deb` and running `setup-runtime.sh` once, ordinary OpenVINO models just need to be placed as a complete directory under your user model directory:

```text
~/.local/share/amuin-ai-stack/models/<model-dir>/
```

For example:

```text
~/.local/share/amuin-ai-stack/models/Qwen3.5-4B-fp16-ov/
~/.local/share/amuin-ai-stack/models/Qwen3-Embedding-0.6B-fp16-ov/
```

The model directory must contain the complete set of files from the upstream repository — config, tokenizer, chat template, and the OpenVINO `.xml` / `.bin` files — not just a single weight file. The app auto-scans these directories on launch; you can also download models directly from the manager console without copying anything manually.

Extra setup per feature:

| Feature | Extra step |
| --- | --- |
| Chat, Vision, ASR-0.6B, Embedding, Rerank | Run `setup-runtime.sh` once, then download the model |
| Qwen3-ASR-1.7B | Also run `setup-qwen3-asr-runtime.sh` |
| Qwen3-TTS | Install extra deps via `setup-runtime.sh --with-tts` |
| GPU / NPU acceleration | Install the matching Intel drivers and firmware first |

The `.deb` does not bundle model weights, nor does it install Intel kernel drivers or NPU firmware.

## Data Directory

User data is stored by default at:

```text
~/.local/share/amuin-ai-stack/
├── models/       model weights
├── state/        app state and database
├── logs/         runtime logs
├── runtime/      OpenVINO Python runtime
└── qwen3-asr/    Qwen3-ASR-1.7B isolated runtime
```

Set `AI_STACK_DATA_HOME` before launch to change the root directory.

## Models & Devices

| Capability | Model | Format | Device | Status |
| --- | --- | --- | --- | --- |
| Chat | Qwen3.5-2B | OpenVINO FP16 | GPU | Verified |
| Vision | Qwen3-VL-4B-Instruct | OpenVINO INT4 | GPU | Verified |
| ASR | Qwen3-ASR-0.6B | OpenVINO INT8 | NPU + CPU | Verified |
| TTS | Qwen3-TTS-0.6B CustomVoice | PyTorch | CPU | Verified |
| Chat (optional) | Qwen3.5-4B | OpenVINO FP16 | GPU | Verified |
| ASR (optional) | Qwen3-ASR-1.7B | OpenVINO INT8 | GPU / CPU | Verified |
| Embedding | Qwen3-Embedding-0.6B | OpenVINO FP16 | NPU | Verified |
| Rerank | Qwen3-Reranker-0.6B | OpenVINO FP16 | GPU | Verified |

Qwen3-ASR-1.7B needs an extra setup step before first use:

```bash
/opt/amuin-ai-stack/ops/scripts/setup-qwen3-asr-runtime.sh
```

ASR-1.7B cannot currently compile on NPU; the manager prefers the GPU and falls back to CPU.

## Model Download Sources

Public download sources for the default models. After installing, paste the repo URL into the **Models** page to download, or download manually with the CLI and drop it into the model directory.

| Capability | Model | Repo ID | Platform |
| --- | --- | --- | --- |
| Chat | Qwen3.5-2B | `amuin02hz/Qwen3.5-2B-OpenVINO-FP16` | ModelScope |
| Vision | Qwen3-VL-4B-Instruct | `Echo9Zulu/Qwen3-VL-4B-Instruct-int4_asym-ov` | Hugging Face |
| ASR | Qwen3-ASR-0.6B | `Echo9Zulu/Qwen3-ASR-0.6B-INT8_ASYM-OpenVINO` | Hugging Face |
| TTS | Qwen3-TTS-0.6B | `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` | Hugging Face |
| Chat (optional) | Qwen3.5-4B | `OpenVINO/Qwen3.5-4B-fp16-ov` | Hugging Face |
| ASR (optional) | Qwen3-ASR-1.7B | `jinhwan000/qwen3-asr-1.7b-ov-int8` | Hugging Face |
| Embedding | Qwen3-Embedding-0.6B | `OpenVINO/Qwen3-Embedding-0.6B-fp16-ov` | Hugging Face |
| Rerank | Qwen3-Reranker-0.6B | `OpenVINO/Qwen3-Reranker-0.6B-fp16-ov` | Hugging Face |

Paste the full URL when importing on the **Models** page:

```text
Hugging Face: https://huggingface.co/<repo_id>
ModelScope:  https://modelscope.cn/models/<repo_id>
```

Or download manually and place it in the model directory:

```bash
# Hugging Face
huggingface-cli download Echo9Zulu/Qwen3-ASR-0.6B-INT8_ASYM-OpenVINO \
  --local-dir ~/.local/share/amuin-ai-stack/models/<model-dir>

# ModelScope
modelscope download --model amuin02hz/Qwen3.5-2B-OpenVINO-FP16 \
  --local_dir ~/.local/share/amuin-ai-stack/models/<model-dir>
```

The directory name is arbitrary — the app auto-detects it on launch. Just make sure it contains the complete upstream files (config, tokenizer, chat template, and OpenVINO `.xml` / `.bin`).

## API Usage

The API listens on `127.0.0.1:8000` only. Start the relevant engine in the manager console first.

List running models:

```bash
curl http://127.0.0.1:8000/v1/models
```

Chat:

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen3.5-2B-fp16-ov",
    "messages": [{"role": "user", "content": "Hello, introduce yourself."}]
  }'
```

Embeddings:

```bash
curl http://127.0.0.1:8000/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"Qwen3-Embedding-0.6B-fp16-ov","input":"Local AI inference"}'
```

Speech recognition:

```bash
curl http://127.0.0.1:8000/v1/audio/transcriptions \
  -F 'model=Qwen3-ASR-0.6B-int8-ov' \
  -F 'file=@sample.wav'
```

## Update & Uninstall

Installing a new version keeps models, state and logs in your user directory:

```bash
sudo apt install ./amuin-ai-stack_NEW_VERSION_amd64.deb
```

Uninstall:

```bash
sudo apt remove amuin-ai-stack
```

To also remove models and runtime data, delete them manually after confirming they are no longer needed:

```bash
rm -rf ~/.local/share/amuin-ai-stack
```

## Known Limitations

- Currently ships `amd64` Debian packages only.
- Model weights must be downloaded separately after install.
- NPU features depend on host drivers and firmware, not just the package.
- Qwen3-ASR-1.7B and Qwen3-Reranker-0.6B dynamic graphs are not NPU-suitable yet and default to GPU.
- The TTS runtime is large, so it is installed separately via `--with-tts`.
- The local API has no authentication by default; do not expose the port to untrusted networks.

## Troubleshooting

Check OpenVINO and devices:

```bash
~/.local/share/amuin-ai-stack/runtime/bin/python -c \
  'import openvino as ov; print(ov.__version__); print(ov.Core().available_devices)'
```

Launch the app in the foreground to see errors directly:

```bash
amuin-ai-stack
```

Logs are under `~/.local/share/amuin-ai-stack/logs/`. If the NPU is not visible, confirm `/dev/accel/accel0` exists and that your user is in the `render` group.

## Privacy & Security

Inference requests, models and logs stay on-device by default. The app only serves the management API on the loopback address and does not upload conversations or audio. Model downloads hit only the Hugging Face or ModelScope repos you choose.

Only download the package from a trusted release page and verify `SHA256SUMS` before installing.

## License

The application code is MIT-licensed; see the bundled `LICENSE`. Model weights follow each model repo's own license and terms of use.

`src/inference/qwen_3_asr_helper.py` is vendored from OpenVINO Notebooks at pinned commit `69b0f57`, licensed under Apache-2.0.
