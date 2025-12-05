"""
Enhanced Whisper.cpp integration for streaming transcription
"""
import subprocess
import threading
import queue
import time
import tempfile
import os
from typing import Optional, Callable
import wave
import numpy as np


class WhisperStreamer:
    """
    Manages whisper.cpp process for streaming transcription
    """
    
    def __init__(
        self,
        model_path: str,
        executable_path: str = "../whisper.cpp/build/bin/whisper-cli",
        step_ms: int = 300,
        length_ms: int = 900,
        threads: int = 6
    ):
        self.model_path = model_path
        self.executable_path = executable_path
        self.step_ms = step_ms
        self.length_ms = length_ms
        self.threads = threads
        
        self.process: Optional[subprocess.Popen] = None
        self.audio_queue = queue.Queue()
        self.result_queue = queue.Queue()
        self.is_running = False
        self.temp_wav_path: Optional[str] = None
        
    def start(self):
        """Start the whisper streaming process"""
        if self.is_running:
            return
        
        self.is_running = True
        
        # Create temporary wav file for streaming
        fd, self.temp_wav_path = tempfile.mkstemp(suffix='.wav')
        os.close(fd)
        
        # Start audio writer thread
        self.writer_thread = threading.Thread(target=self._audio_writer, daemon=True)
        self.writer_thread.start()
        
        # Start whisper process thread
        self.whisper_thread = threading.Thread(target=self._run_whisper, daemon=True)
        self.whisper_thread.start()
    
    def stop(self):
        """Stop the whisper process"""
        self.is_running = False
        
        if self.process:
            self.process.terminate()
            self.process.wait(timeout=5)
            self.process = None
        
        if self.temp_wav_path and os.path.exists(self.temp_wav_path):
            try:
                os.unlink(self.temp_wav_path)
            except:
                pass
    
    def feed_audio(self, audio_data: bytes):
        """Feed audio data for transcription"""
        if self.is_running:
            self.audio_queue.put(audio_data)
    
    def get_result(self, timeout: float = 0.1) -> Optional[str]:
        """Get transcription result if available"""
        try:
            return self.result_queue.get(timeout=timeout)
        except queue.Empty:
            return None
    
    def _audio_writer(self):
        """Thread that writes audio data to WAV file continuously"""
        sample_rate = 16000
        channels = 1
        sample_width = 2  # 16-bit
        
        accumulated_audio = bytearray()
        
        while self.is_running:
            try:
                # Get audio chunk
                chunk = self.audio_queue.get(timeout=0.1)
                accumulated_audio.extend(chunk)
                
                # Write to WAV file when we have enough data
                if len(accumulated_audio) >= sample_rate * sample_width * 1:  # 1 second
                    with wave.open(self.temp_wav_path, 'wb') as wf:
                        wf.setnchannels(channels)
                        wf.setsampwidth(sample_width)
                        wf.setframerate(sample_rate)
                        wf.writeframes(bytes(accumulated_audio))
                    
                    # Keep last 2 seconds for context
                    keep_bytes = sample_rate * sample_width * 2
                    if len(accumulated_audio) > keep_bytes:
                        accumulated_audio = accumulated_audio[-keep_bytes:]
            
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Audio writer error: {e}")
    
    def _run_whisper(self):
        """Thread that runs whisper.cpp process"""
        while self.is_running:
            try:
                # Wait for wav file to have data
                if not os.path.exists(self.temp_wav_path):
                    time.sleep(0.1)
                    continue
                
                # Check file size
                if os.path.getsize(self.temp_wav_path) < 1000:
                    time.sleep(0.1)
                    continue
                
                # Run whisper.cpp
                cmd = [
                    "taskpolicy", "-b",
                    self.executable_path,
                    "-m", self.model_path,
                    "-t", str(self.threads),
                    "--step", str(self.step_ms),
                    "--length", str(self.length_ms),
                    "--max-context", "256",
                    "--no-keep-context",
                    "--beam-size", "1",
                    "--best-of", "1",
                    "--no-timestamps",
                    "--temperature", "0",
                    "-f", self.temp_wav_path,
                    "--no-prints"
                ]
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=2.0
                )
                
                if result.returncode == 0 and result.stdout:
                    # Extract transcription from output
                    text = result.stdout.strip()
                    if text:
                        self.result_queue.put(text)
                
                time.sleep(0.3)  # Match step_ms
            
            except subprocess.TimeoutExpired:
                continue
            except Exception as e:
                print(f"Whisper process error: {e}")
                time.sleep(0.5)


# Alternative: Simpler approach using continuous file updates
class SimpleWhisperStreamer:
    """
    Simplified whisper streaming that accumulates audio and transcribes periodically
    """
    
    def __init__(self, model_path: str, executable_path: str = "../whisper.cpp/build/bin/whisper-cli"):
        self.model_path = model_path
        self.executable_path = executable_path
        self.audio_buffer = bytearray()
        self.sample_rate = 16000
        self.last_transcribe_time = 0
        self.transcribe_interval = 1.0  # Transcribe every 1 second
        
    def feed_audio(self, audio_data: bytes):
        """Accumulate audio data"""
        self.audio_buffer.extend(audio_data)
    
    def should_transcribe(self) -> bool:
        """Check if enough time has passed to transcribe"""
        current_time = time.time()
        if current_time - self.last_transcribe_time >= self.transcribe_interval:
            return len(self.audio_buffer) > self.sample_rate * 2  # At least 1 second
        return False
    
    def transcribe(self) -> Optional[str]:
        """Transcribe accumulated audio"""
        if not self.should_transcribe():
            return None
        
        self.last_transcribe_time = time.time()
        
        # Create temporary wav file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_path = temp_file.name
            
            try:
                # Write WAV file
                with wave.open(temp_path, 'wb') as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(self.sample_rate)
                    wf.writeframes(bytes(self.audio_buffer))
                
                # Run whisper
                cmd = [
                    self.executable_path,
                    "-m", self.model_path,
                    "-t", "6",
                    "-f", temp_path,
                    "-nt"  # No timestamps in output
                ]
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=5.0
                )
                
                # Keep last 2 seconds for context
                keep_samples = self.sample_rate * 2 * 2  # 2 seconds * 2 bytes per sample
                self.audio_buffer = self.audio_buffer[-keep_samples:]
                
                if result.returncode == 0:
                    # Parse output
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        if line.strip() and not line.startswith('['):
                            return line.strip()
                
                return None
            
            finally:
                # Cleanup
                try:
                    os.unlink(temp_path)
                except:
                    pass
    
    def reset(self):
        """Clear buffer"""
        self.audio_buffer = bytearray()
        self.last_transcribe_time = 0