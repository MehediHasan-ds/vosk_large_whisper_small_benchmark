"""
Benchmark script for comparing Vosk and Whisper performance
"""
import time
import wave
import json
import numpy as np
from pathlib import Path
from vosk import Model, KaldiRecognizer
import subprocess


def load_test_audio(file_path: str):
    """Load test audio file"""
    with wave.open(file_path, 'rb') as wf:
        assert wf.getnchannels() == 1, "Audio must be mono"
        assert wf.getframerate() == 16000, "Sample rate must be 16000"
        
        frames = wf.readframes(wf.getnframes())
        return frames


def benchmark_vosk(audio_data: bytes, model_path: str, chunk_size: int = 4000):
    """Benchmark Vosk transcription"""
    print(f"\n{'='*60}")
    print(f"VOSK BENCHMARK (chunk_size={chunk_size})")
    print(f"{'='*60}")
    
    # Initialize
    model = Model(model_path)
    recognizer = KaldiRecognizer(model, 16000)
    recognizer.SetWords(True)
    
    # Process audio
    start_time = time.time()
    chunk_times = []
    results = []
    
    for i in range(0, len(audio_data), chunk_size):
        chunk = audio_data[i:i + chunk_size]
        
        chunk_start = time.time()
        
        if recognizer.AcceptWaveform(chunk):
            result = json.loads(recognizer.Result())
            if result.get('text'):
                results.append(result['text'])
        else:
            partial = json.loads(recognizer.PartialResult())
        
        chunk_time = time.time() - chunk_start
        chunk_times.append(chunk_time)
    
    # Final result
    final_result = json.loads(recognizer.FinalResult())
    if final_result.get('text'):
        results.append(final_result['text'])
    
    total_time = time.time() - start_time
    audio_duration = len(audio_data) / (16000 * 2)  # 16-bit samples
    
    # Calculate metrics
    avg_chunk_time = np.mean(chunk_times) * 1000  # Convert to ms
    rtf = total_time / audio_duration
    
    print(f"\nResults:")
    print(f"  Transcription: {' '.join(results)}")
    print(f"\nPerformance:")
    print(f"  Total processing time: {total_time:.2f}s")
    print(f"  Audio duration: {audio_duration:.2f}s")
    print(f"  Real-time factor: {rtf:.3f}x")
    print(f"  Average chunk time: {avg_chunk_time:.2f}ms")
    print(f"  Chunks processed: {len(chunk_times)}")
    print(f"  {'✓ REAL-TIME' if rtf < 1.0 else '✗ NOT REAL-TIME'}")
    
    return {
        'model': 'vosk',
        'total_time': total_time,
        'audio_duration': audio_duration,
        'rtf': rtf,
        'avg_chunk_time_ms': avg_chunk_time,
        'transcription': ' '.join(results)
    }


def benchmark_whisper(audio_file: str, model_path: str, executable: str):
    """Benchmark Whisper.cpp transcription"""
    print(f"\n{'='*60}")
    print(f"WHISPER.CPP BENCHMARK")
    print(f"{'='*60}")
    
    # Get audio duration
    with wave.open(audio_file, 'rb') as wf:
        audio_duration = wf.getnframes() / wf.getframerate()
    
    # Run whisper
    cmd = [
        "taskpolicy", "-b",
        executable,
        "-m", model_path,
        "-t", "6",
        "--step", "300",
        "--length", "900",
        "--max-context", "256",
        "--no-keep-context",
        "--beam-size", "1",
        "--best-of", "1",
        "--no-timestamps",
        "--temperature", "0",
        "-f", audio_file
    ]
    
    start_time = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    total_time = time.time() - start_time
    
    # Parse output
    transcription = ""
    if result.returncode == 0:
        lines = result.stdout.strip().split('\n')
        for line in lines:
            if line.strip() and not line.startswith('['):
                transcription += line.strip() + " "
    
    rtf = total_time / audio_duration
    
    print(f"\nResults:")
    print(f"  Transcription: {transcription.strip()}")
    print(f"\nPerformance:")
    print(f"  Total processing time: {total_time:.2f}s")
    print(f"  Audio duration: {audio_duration:.2f}s")
    print(f"  Real-time factor: {rtf:.3f}x")
    print(f"  {'✓ REAL-TIME' if rtf < 1.0 else '✗ NOT REAL-TIME'}")
    
    return {
        'model': 'whisper',
        'total_time': total_time,
        'audio_duration': audio_duration,
        'rtf': rtf,
        'transcription': transcription.strip()
    }


def compare_models(vosk_result: dict, whisper_result: dict):
    """Compare results from both models"""
    print(f"\n{'='*60}")
    print(f"MODEL COMPARISON")
    print(f"{'='*60}")
    
    print(f"\n{' '*20}Vosk{' '*15}Whisper")
    print(f"{'─'*60}")
    print(f"RTF:           {vosk_result['rtf']:8.3f}x      {whisper_result['rtf']:8.3f}x")
    print(f"Processing:    {vosk_result['total_time']:8.2f}s      {whisper_result['total_time']:8.2f}s")
    print(f"Real-time:     {'    ✓' if vosk_result['rtf'] < 1.0 else '    ✗'}             {'    ✓' if whisper_result['rtf'] < 1.0 else '    ✗'}")
    
    # Winner
    print(f"\n{'='*60}")
    if vosk_result['rtf'] < whisper_result['rtf']:
        print(f"WINNER: Vosk (faster by {whisper_result['rtf'] / vosk_result['rtf']:.2f}x)")
    else:
        print(f"WINNER: Whisper (faster by {vosk_result['rtf'] / whisper_result['rtf']:.2f}x)")


def main():
    """Run benchmarks"""
    VOSK_MODEL = "../models/vosk-model-en-us-0.22"
    WHISPER_MODEL = "../whisper.cpp/models/ggml-small.en-tdrz.bin"
    WHISPER_EXEC = "../whisper.cpp/main"
    TEST_AUDIO = "test_audio.wav"  # You need to provide this
    
    # Check if test audio exists
    if not Path(TEST_AUDIO).exists():
        print(f"Error: Test audio file '{TEST_AUDIO}' not found!")
        print("Please provide a 16kHz mono WAV file for testing.")
        return
    
    # Load audio
    print(f"Loading test audio: {TEST_AUDIO}")
    audio_data = load_test_audio(TEST_AUDIO)
    print(f"Audio loaded: {len(audio_data)} bytes")
    
    # Benchmark Vosk
    vosk_result = benchmark_vosk(audio_data, VOSK_MODEL, chunk_size=4000)
    
    # Benchmark Whisper
    whisper_result = benchmark_whisper(TEST_AUDIO, WHISPER_MODEL, WHISPER_EXEC)
    
    # Compare
    compare_models(vosk_result, whisper_result)
    
    # Save results
    results = {
        'vosk': vosk_result,
        'whisper': whisper_result,
        'timestamp': time.time()
    }
    
    with open('benchmark_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\n✓ Results saved to benchmark_results.json")


if __name__ == "__main__":
    main()
