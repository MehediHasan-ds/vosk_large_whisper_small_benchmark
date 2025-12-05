import asyncio
import json
import time
import subprocess
import os
from pathlib import Path
from typing import Optional, Dict, Any
import psutil
import numpy as np
import uvicorn

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from vosk import Model, KaldiRecognizer
from whisper_stream import SimpleWhisperStreamer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAMPLE_RATE = 16000
VOSK_MODEL_PATH = "../models/vosk-model-en-us-0.22"
WHISPER_MODEL_PATH = "../whisper.cpp/models/ggml-small.en-tdrz.bin"
WHISPER_EXECUTABLE = "../whisper.cpp/build/bin/whisper-cli"

vosk_model: Optional[Model] = None
current_model = "vosk"  # Default model


def initialize_vosk():
    """Initialize Vosk model"""
    global vosk_model
    if not os.path.exists(VOSK_MODEL_PATH):
        raise FileNotFoundError(f"Vosk model not found at {VOSK_MODEL_PATH}")
    vosk_model = Model(VOSK_MODEL_PATH)
    print(f"✓ Vosk model loaded from {VOSK_MODEL_PATH}")


class PerformanceMonitor:
    """Monitor CPU, memory, and processing metrics"""
    
    def __init__(self):
        self.process = psutil.Process()
        self.start_time = time.time()
        self.chunk_times = []
        self.token_counts = []
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get current performance metrics"""
        cpu_percent = self.process.cpu_percent(interval=0.1)
        memory_info = self.process.memory_info()
        memory_mb = memory_info.rss / 1024 / 1024
        
        avg_chunk_time = np.mean(self.chunk_times[-10:]) if self.chunk_times else 0
        
        return {
            "cpu_percent": round(cpu_percent, 2),
            "memory_mb": round(memory_mb, 2),
            "avg_chunk_time_ms": round(avg_chunk_time * 1000, 2),
            "rtf": round(avg_chunk_time / 0.5, 3) if avg_chunk_time > 0 else 0,  # Assuming 0.5s audio chunks
        }
    
    def record_chunk_time(self, duration: float):
        """Record processing time for a chunk"""
        self.chunk_times.append(duration)
        if len(self.chunk_times) > 100:
            self.chunk_times.pop(0)


class VoskTranscriber:
    """Vosk-based transcription"""
    
    def __init__(self, chunk_size: int = 4000):
        if vosk_model is None:
            raise RuntimeError("Vosk model not initialized")
        self.recognizer = KaldiRecognizer(vosk_model, SAMPLE_RATE)
        self.recognizer.SetWords(True)
        self.chunk_size = chunk_size
        self.monitor = PerformanceMonitor()
    
    async def process_chunk(self, audio_data: bytes) -> Dict[str, Any]:
        """Process audio chunk and return partial/final results"""
        start_time = time.time()
        
        # Process audio
        if self.recognizer.AcceptWaveform(audio_data):
            result = json.loads(self.recognizer.Result())
            result_type = "final"
        else:
            result = json.loads(self.recognizer.PartialResult())
            result_type = "partial"
        
        processing_time = time.time() - start_time
        self.monitor.record_chunk_time(processing_time)
        
        return {
            "type": result_type,
            "text": result.get("text", result.get("partial", "")),
            "metrics": self.monitor.get_metrics(),
            "processing_time_ms": round(processing_time * 1000, 2)
        }
    
    def reset(self):
        """Reset recognizer state"""
        self.recognizer = KaldiRecognizer(vosk_model, SAMPLE_RATE)
        self.recognizer.SetWords(True)


class WhisperTranscriber:
    """Whisper.cpp-based transcription"""
    
    def __init__(self):
        self.monitor = PerformanceMonitor()
        self.streamer = SimpleWhisperStreamer(
            model_path=WHISPER_MODEL_PATH,
            executable_path=WHISPER_EXECUTABLE
        )
    
    async def process_chunk(self, audio_data: bytes) -> Dict[str, Any]:
        """Process audio chunk"""
        start_time = time.time()
        
        # Feed audio to streamer
        self.streamer.feed_audio(audio_data)
        
        # Try to get transcription
        text = self.streamer.transcribe()
        
        processing_time = time.time() - start_time
        self.monitor.record_chunk_time(processing_time)
        
        return {
            "type": "partial" if text else "buffering",
            "text": text or "",
            "metrics": self.monitor.get_metrics(),
            "processing_time_ms": round(processing_time * 1000, 2)
        }
    
    def reset(self):
        """Reset buffer"""
        self.streamer.reset()

@app.on_event("startup")
async def startup_event():
    """Initialize models on startup"""
    initialize_vosk()
    print("✓ Backend ready")


@app.get("/")
async def root():
    return {"status": "running", "current_model": current_model}


@app.get("/api/model")
async def get_model():
    """Get current model"""
    return {"model": current_model}


@app.post("/api/model")
async def set_model(data: dict):
    """Switch model"""
    global current_model
    model = data.get("model", "vosk")
    if model in ["vosk", "whisper"]:
        current_model = model
        return {"model": current_model, "status": "switched"}
    return {"error": "Invalid model"}, 400


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """WebSocket endpoint for real-time transcription"""
    global current_model

    await websocket.accept()
    
    transcriber = None
    
    try:
        # Send initial connection message
        await websocket.send_json({
            "type": "connected",
            "model": current_model
        })
        
        # Initialize appropriate transcriber
        if current_model == "vosk":
            transcriber = VoskTranscriber(chunk_size=4000)
        else:
            transcriber = WhisperTranscriber()
        
        print(f"Client connected with {current_model} model")
        
        while True:
            # Receive audio data
            data = await websocket.receive()
            
            if "bytes" in data:
                audio_chunk = data["bytes"]
                
                # Process chunk
                result = await transcriber.process_chunk(audio_chunk)
                
                # Send result back to client
                await websocket.send_json(result)
            
            elif "text" in data:

                # Handle control messages
                message = json.loads(data["text"])
                
                if message.get("action") == "reset":
                    transcriber.reset()
                    await websocket.send_json({"type": "reset", "status": "ok"})
                
                elif message.get("action") == "switch_model":
                    new_model = message.get("model")
                    if new_model in ["vosk", "whisper"]:
                        
                        current_model = new_model
                        
                        # Recreate transcriber
                        if current_model == "vosk":
                            transcriber = VoskTranscriber(chunk_size=4000)
                        else:
                            transcriber = WhisperTranscriber()
                        
                        await websocket.send_json({
                            "type": "model_switched",
                            "model": current_model
                        })
    
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
    finally:
        if transcriber:
            transcriber.reset()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

    