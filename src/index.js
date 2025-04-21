import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import multer from "multer";
import { Readable } from "stream";
// import cron from "node-cron";

dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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

// 🎙️ Transcribe audio to text using AssemblyAI
async function transcribeAudio(audioBuffer) {
  try {
    console.log("🎙️ Sending audio to AssemblyAI for transcription...");
    // 1. Upload audio file to AssemblyAI
    const uploadRes = await axios.post(
      "https://api.assemblyai.com/v2/upload",
      audioBuffer,
      {
        headers: {
          authorization: process.env.ASSEMBLY_API_KEY,
          "content-type": "application/octet-stream",
        },
      }
    );
    const uploadUrl = uploadRes.data.upload_url;
    // 2. Request transcription
    const transcriptRes = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: uploadUrl,
        language_code: "en",
        punctuate: true,
        format_text: true,
      },
      {
        headers: {
          authorization: process.env.ASSEMBLY_API_KEY,
          "content-type": "application/json",
        },
      }
    );
    const transcriptId = transcriptRes.data.id;
    // 3. Poll for completion
    let transcript = "";
    let status = transcriptRes.data.status;
    let pollCount = 0;
    while (status !== "completed" && status !== "failed" && pollCount < 60) {
      await new Promise((res) => setTimeout(res, 2000));
      const pollRes = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { authorization: process.env.ASSEMBLY_API_KEY },
        }
      );
      status = pollRes.data.status;
      if (status === "completed") {
        transcript = pollRes.data.text;
      }
      pollCount++;
    }
    if (!transcript) {
      throw new Error("Transcription failed or timed out");
    }
    console.log("🎙️ AssemblyAI transcription complete:", transcript);
    return transcript;
  } catch (error) {
    console.error(
      "❌ Error with AssemblyAI transcription:",
      error.response?.data || error.message
    );
    return "";
  }
}

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

server.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
