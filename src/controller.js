import express from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import {
  getAIResponse,
  generateAudioResponse,
  transcribeAudio,
} from "./aibot.js";
import { liveKitConfig } from "./env.config.js";
import multer from "multer";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Room client for LiveKit REST API
const client = new RoomServiceClient(
  liveKitConfig.projectUrl,
  liveKitConfig.apiKey,
  liveKitConfig.apiSecret
);

/**
 * 🎯 API: Create room & return token
 */
router.post("/api/create-room", async (req, res) => {
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
router.post("/api/send-message", async (req, res) => {
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
router.post("/api/audio-message", upload.single("audio"), async (req, res) => {
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

    let trimmedResponse;

    if (transcribedText === "Error with AssemblyAI transcription") {
      trimmedResponse = "Error while processing audio";
    } else {
      // 2. Process transcribed text with Gemini AI
      const aiResponse = await getAIResponse(transcribedText);
      trimmedResponse = aiResponse.trim();
    }

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

// Optionally, add a root endpoint for health check
router.get("/", (req, res) => {
  res.send("Welcome to the AI Chat API!");
});

export default router;
