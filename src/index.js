import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import cron from "node-cron";

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// LiveKit config
const liveKitConfig = {
  websocketUrl: process.env.LIVEKIT_WEBSOCKET_URL,
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
  projectUrl: process.env.LIVEKIT_HTTP_URL,
};

// Gemini AI config
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = gemini.getGenerativeModel({ model: "gemini-1.5-pro" });

// Room client for LiveKit REST API
const client = new RoomServiceClient(
  liveKitConfig.projectUrl,
  liveKitConfig.apiKey,
  liveKitConfig.apiSecret
);

// 🧠 AI Response
async function getAIResponse(userInput) {
  try {
    console.log("📩 User input to AI:", userInput);
    const result = await model.generateContent(
      `Reply in short to the user: ${userInput}`
    );
    const response = result.response;
    const text = response.text();
    console.log("🤖 AI Response:", text);
    return text;
  } catch (error) {
    console.error("❌ Error from Gemini:", error);
    return "Sorry, I'm having trouble responding right now.";
  }
}

// 🎤 Generate AI audio using ElevenLabs TTS
async function generateAudioResponse(text) {
  try {
    const voiceId = "DMyrgzQFny3JI1Y1paM5"; // Set voice ID, update with any voice you want

    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        text,
      },
      {
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY, // Use your ElevenLabs API Key here
          "Content-Type": "application/json", // Ensure the content type is correct
        },
        responseType: "arraybuffer", // Audio in binary format
      }
    );

    return response.data; // Return audio data
  } catch (error) {
    console.error("❌ Error generating audio:", error);
    return null;
  }
}

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

app.get("/", (req, res) => {
  res.send("Welcome to the AI Chat API!");
});

// 🕒 Cron Job: Hit welcome API every 2 minutes
cron.schedule("*/1 * * * *", async () => {
  try {
    console.log("🚀 Cron Job Running: Hitting welcome API");
    const response = await axios.get(`http://localhost:${PORT}/`);
    console.log("✅ Cron Response:", response.data);
  } catch (error) {
    console.error("❌ Cron Job Error:", error.message);
  }
});

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
