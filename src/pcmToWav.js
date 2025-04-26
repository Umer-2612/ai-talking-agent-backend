// src/pcmToWav.js
// Utility to convert PCM buffer (16-bit LE, mono, 16kHz) to WAV buffer

export function pcmToWavBuffer(pcmBuffer, sampleRate = 16000, numChannels = 1) {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const wavHeader = Buffer.alloc(44);

  // RIFF chunk descriptor
  wavHeader.write("RIFF", 0); // ChunkID
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4); // ChunkSize
  wavHeader.write("WAVE", 8); // Format

  // fmt subchunk
  wavHeader.write("fmt ", 12); // Subchunk1ID
  wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  wavHeader.writeUInt16LE(numChannels, 22); // NumChannels
  wavHeader.writeUInt32LE(sampleRate, 24); // SampleRate
  wavHeader.writeUInt32LE(byteRate, 28); // ByteRate
  wavHeader.writeUInt16LE(blockAlign, 32); // BlockAlign
  wavHeader.writeUInt16LE(16, 34); // BitsPerSample

  // data subchunk
  wavHeader.write("data", 36); // Subchunk2ID
  wavHeader.writeUInt32LE(pcmBuffer.length, 40); // Subchunk2Size

  return Buffer.concat([wavHeader, pcmBuffer]);
}
