import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { serverConfig, geminiConfig } from "./env.config.js";
import controller from "./controller.js";
import { WebSocketServer } from "ws";
import Vad from "node-vad";
import {
  generateAudioResponse,
  getAIResponse,
  transcribeAudio,
} from "./aibot.js";
import aiJobQueue from "./queue.js";
import { pcmToWavBuffer } from "./pcmToWav.js";

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = serverConfig.port;

app.use(
  cors({
    origin: serverConfig.corsOrigin,
  })
);
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Gemini AI config
const gemini = new GoogleGenerativeAI(geminiConfig.apiKey);
export const model = gemini.getGenerativeModel({ model: "gemini-1.5-pro" });

app.use(controller);

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);

  // Set up WebSocket server for audio
  const wss = new WebSocketServer({ server, path: "/ws/audio" });
  wss.on("connection", (ws) => {
    console.log("🔗 New WebSocket connection established on /ws/audio");
    let audioBuffer = Buffer.alloc(0);
    let silenceStart = null;
    const silenceTimeout = 300; // ms
    const vad = new Vad(Vad.Mode.VERY_AGGRESSIVE);
    let leftover = null; // For odd-length PCM chunks

    // --- PCM streaming handler: expects raw PCM, mono, 16kHz, 16-bit LE ---
    ws.on("message", async (message) => {
      // message is expected to be a Buffer containing raw PCM data
      console.log(`📩 [WebSocket] Received PCM chunk: ${message.length} bytes`);
      // Handle leftover byte from previous chunk (for odd-length buffers)
      if (leftover) {
        message = Buffer.concat([leftover, message]);
        leftover = null;
      }
      if (message.length % 2 !== 0) {
        leftover = message.slice(message.length - 1);
        message = message.slice(0, message.length - 1);
      }
      if (message.length === 0 || !message) {
        console.log("[PCM] Received empty chunk, skipping.");
        return;
      }
      audioBuffer = Buffer.concat([audioBuffer, message]);
      try {
        const result = await vad.processAudio(message, 16000);
        console.log("[VAD] Result for chunk:", result);
        if (result === Vad.Event.SILENCE) {
          if (!silenceStart) silenceStart = Date.now();
          if (Date.now() - silenceStart > silenceTimeout) {
            const utteranceBuffer = audioBuffer;
            audioBuffer = Buffer.alloc(0);
            silenceStart = null;
            aiJobQueue.enqueue(async () => {
              const hasSpeech = await bufferContainsSpeech(
                utteranceBuffer,
                vad
              );
              if (hasSpeech) {
                console.log(
                  "✅ Speech detected in utterance buffer. Sending to analyse pipeline..."
                );
                // Convert to WAV before sending to AssemblyAI
                const wavBuffer = pcmToWavBuffer(utteranceBuffer, 16000, 1);
                try {
                  ws.send(
                    JSON.stringify({
                      event_type: "disappear",
                      message: "Speech detected. Transcribing...",
                    })
                  );
                  const transcribedText = await transcribeAudio(wavBuffer);
                  if (
                    transcribedText === "Error with AssemblyAI transcription" ||
                    !transcribedText
                  ) {
                    return;
                  }
                  console.log("🎙️ Transcribed text:", transcribedText);
                  ws.send(
                    JSON.stringify({
                      event_type: "disappear",
                      message: "Transcribed text now sending to Gemini AI...",
                    })
                  );
                  const aiResponse = await getAIResponse(transcribedText);
                  const trimmedResponse = aiResponse.trim();
                  console.log("🤖 AI response to audio:", trimmedResponse);
                  ws.send(
                    JSON.stringify({
                      event_type: "disappear",
                      message: "AI response now sending to client...",
                    })
                  );
                  const audioData = await generateAudioResponse(
                    trimmedResponse
                  );
                  if (audioData) {
                    ws.send(
                      JSON.stringify({
                        event_type: "final_response",
                        userText: transcribedText,
                        aiResponse: trimmedResponse,
                        audio: Buffer.from(audioData).toString("base64"),
                        role: "AI",
                      })
                    );
                  } else {
                    ws.send(
                      JSON.stringify({
                        error: "Failed to generate audio response",
                      })
                    );
                  }
                } catch (err) {
                  console.error("Error in analyse pipeline:", err);
                  ws.send(
                    JSON.stringify({
                      error: "Internal pipeline error",
                      details: err.message,
                    })
                  );
                }
              } else {
                console.log("❌ No valid speech detected in utterance buffer.");
              }
            });
          }
        } else {
          silenceStart = null;
        }
      } catch (err) {
        console.error("[VAD] Error:", err, { message });
      }
    });
    ws.on("close", () => {
      console.log("❌ WebSocket connection closed on /ws/audio");
    });
    ws.on("error", (err) => {
      console.error("WebSocket error on /ws/audio:", err);
    });
  });
  console.log(`🚀 WebSocket server listening at ws://localhost:${PORT}`);
});

async function bufferContainsSpeech(
  buffer,
  vad,
  sampleRate = 16000,
  frameMs = 30
) {
  const frameSize = ((sampleRate * frameMs) / 1000) * 2;
  for (let i = 0; i + frameSize <= buffer.length; i += frameSize) {
    const frame = buffer.slice(i, i + frameSize);
    try {
      const result = await vad.processAudio(frame, sampleRate);
      console.log("[VAD] Result for frame:", result);
      if (result === Vad.Event.VOICE) return true;
    } catch (err) {
      console.warn("[VAD] Error processing frame:", err);
    }
  }
  return false;
}
