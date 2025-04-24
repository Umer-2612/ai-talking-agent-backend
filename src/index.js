import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";
import { liveKitConfig, serverConfig, geminiConfig } from "./env.config.js";

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

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Gemini AI config
const gemini = new GoogleGenerativeAI(geminiConfig.apiKey);
export const model = gemini.getGenerativeModel({ model: "gemini-1.5-pro" });

// Room client for LiveKit REST API
const client = new RoomServiceClient(
  liveKitConfig.projectUrl,
  liveKitConfig.apiKey,
  liveKitConfig.apiSecret
);

/**
 * 🎯 API: Create room & return token
 */
app.post("/api/create-room", async (req, res) => {
  try {
    const room = await client.createRoom({
      name: `AI-Chat-${Date.now()}`,
      emptyTimeout: 600,
      maxParticipants: 10,
    });

    const at = new AccessToken(liveKitConfig.apiKey, liveKitConfig.apiSecret, {
      identity: `User-${Math.floor(Math.random() * 1000)}`,
    });
    at.addGrant({ roomJoin: true, room: room.name });
    const token = await at.toJwt();

    res.status(200).json({
      message: "Room created and token generated.",
      token,
      roomName: room.name,
    });
  } catch (error) {
    console.error("❌ Error creating room:", error);
    res.status(500).json({ error: "Failed to create room" });
  }
});

/**
 * ✉️ API: User message → AI → Return response (not LiveKit broadcast anymore)
 */
app.post("/api/send-message", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const aiResponse = await getAIResponse(message);
    const trimmedResponse = aiResponse.trim();

    // Generate audio response using ElevenLabs TTS
    const audioData = await generateAudioResponse(trimmedResponse);

    if (audioData) {
      // Here, you can send the audio data to the LiveKit room, either as a stream or via a broadcast.
      // For simplicity, we will return the audio in the response.
      res.status(200).json({
        response: trimmedResponse,
        role: "AI",
        audio: audioData.toString("base64"), // Audio data as base64
      });
    } else {
      res.status(500).json({ error: "Failed to generate audio" });
    }
  } catch (error) {
    console.error("❌ AI error:", error);
    res.status(500).json({ error: "AI failed to respond" });
  }
});

/**
 * 🎤🎧 API: Audio message → Transcribe → AI → Audio Response
 */
app.post("/api/audio-message", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    console.log(
      "📩 Received audio file:",
      req.file.originalname,
      "Size:",
      req.file.size
    );

    // 1. Transcribe the audio to text using AssemblyAI
    console.log("🎙️ Starting AssemblyAI transcription process...");
    const transcribedText = await transcribeAudio(req.file.buffer);

    if (!transcribedText) {
      return res.status(400).json({ error: "Could not transcribe audio" });
    }

    console.log("🎙️ Transcribed text:", transcribedText);

    // 2. Process transcribed text with Gemini AI
    const aiResponse = await getAIResponse(transcribedText);
    const trimmedResponse = aiResponse.trim();
    console.log("🤖 AI response to audio:", trimmedResponse);

    // 3. Generate audio response using ElevenLabs TTS
    const audioData = await generateAudioResponse(trimmedResponse);

    if (audioData) {
      res.status(200).json({
        transcribedText,
        response: trimmedResponse,
        audio: audioData.toString("base64"), // Audio data as base64
        role: "AI",
      });
    } else {
      res.status(500).json({ error: "Failed to generate audio response" });
    }
  } catch (error) {
    console.error("❌ Error processing audio message:", error);
    res.status(500).json({
      error: "Failed to process audio message",
      details: error.message,
    });
  }
});

app.get("/", (req, res) => {
  res.send("Welcome to the AI Chat API!");
});

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
