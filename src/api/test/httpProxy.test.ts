import assert from "node:assert/strict";
import test from "node:test";

import { mergeWavBuffers } from "../src/httpProxy.js";

function makePcmWav(samples: number[], sampleRate = 24_000): Buffer {
  const audio = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => audio.writeInt16LE(sample, index * 2));

  const wav = Buffer.alloc(44 + audio.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(audio.length, 40);
  audio.copy(wav, 44);
  return wav;
}

test("mergeWavBuffers combines PCM data under one valid WAV header", () => {
  const merged = mergeWavBuffers([
    makePcmWav([100, -100]),
    makePcmWav([200, -200, 300])
  ]);

  assert.equal(merged.toString("ascii", 0, 4), "RIFF");
  assert.equal(merged.toString("ascii", 8, 12), "WAVE");
  assert.equal(merged.readUInt32LE(4), merged.length - 8);
  assert.equal(merged.readUInt32LE(40), 10);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => merged.readInt16LE(44 + index * 2)),
    [100, -100, 200, -200, 300]
  );
});

test("mergeWavBuffers rejects incompatible or malformed chunks", () => {
  assert.throws(
    () => mergeWavBuffers([makePcmWav([1], 24_000), makePcmWav([2], 16_000)]),
    /incompatible audio formats/
  );
  assert.throws(() => mergeWavBuffers([Buffer.from("not a wav")]), /invalid WAV chunk/);
  assert.throws(() => mergeWavBuffers([]), /No WAV chunks/);
});
