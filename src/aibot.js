import axios from "axios";
import { model } from "./index.js";
import { assemblyConfig } from "./env.config.js";

// 🧠 AI Response
export async function getAIResponse(userInput) {
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
export async function generateAudioResponse(text) {
  try {
    const response = await axios.post(
      `${elevenLabsConfig.apiUrl}/text-to-speech/${elevenLabsConfig.voiceId}/stream`,
      {
        text,
      },
      {
        headers: {
          "xi-api-key": elevenLabsConfig.apiKey, // Use your ElevenLabs API Key here
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

// 🎙️ Transcribe audio to text using AssemblyAI
export async function transcribeAudio(audioBuffer) {
  try {
    console.log("🎙️ Sending audio to AssemblyAI for transcription...");
    // 1. Upload audio file to AssemblyAI
    const uploadRes = await axios.post(
      `${assemblyConfig.apiUrl}/upload`,
      audioBuffer,
      {
        headers: {
          authorization: assemblyConfig.apiKey,
          "content-type": "application/octet-stream",
        },
      }
    );
    const uploadUrl = uploadRes.data.upload_url;
    // 2. Request transcription
    const transcriptRes = await axios.post(
      `${assemblyConfig.apiUrl}/transcript`,
      {
        audio_url: uploadUrl,
        language_code: "en",
        punctuate: true,
        format_text: true,
      },
      {
        headers: {
          authorization: assemblyConfig.apiKey,
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
        `${assemblyConfig.apiUrl}/transcript/${transcriptId}`,
        {
          headers: { authorization: assemblyConfig.apiKey },
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
