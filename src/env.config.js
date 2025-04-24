import dotenv from "dotenv";
dotenv.config();

export const serverConfig = {
  port: process.env.PORT || 3000,
  corsOrigin: process.env.CORS_ORIGIN || "*",
};

// LiveKit config
export const liveKitConfig = {
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
  projectUrl: process.env.LIVEKIT_URL,
};

export const geminiConfig = {
  apiKey: process.env.GEMINI_API_KEY,
};

export const assemblyConfig = {
  apiKey: process.env.ASSEMBLY_API_KEY,
  apiUrl: process.env.ASSEMBLY_API_URL || "https://api.assemblyai.com/v2",
};

export const elevenLabsConfig = {
  apiKey: process.env.ELEVENLABS_API_KEY,
  apiUrl: process.env.ELEVENLABS_API_URL || "https://api.elevenlabs.io/v1",
  voiceId: process.env.ELEVENLABS_VOICE_ID || "DMyrgzQFny3JI1Y1paM5", // Default voice ID
};
