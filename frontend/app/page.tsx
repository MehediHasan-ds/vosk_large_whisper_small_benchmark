'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, RefreshCw, BarChart3, Settings } from 'lucide-react';
import MetricsDisplay from '@/components/MetricsDisplay';
import ComparisonView from '@/components/ComparisonView';

interface TranscriptSegment {
  text: string;
  type: 'partial' | 'final';
  timestamp: number;
}

interface Metrics {
  cpu_percent: number;
  memory_mb: number;
  avg_chunk_time_ms: number;
  rtf: number;
  processing_time_ms?: number;
}

interface SessionData {
  model: string;
  timestamp: number;
  duration: number;
  metrics: Metrics[];
  transcript: string;
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [currentModel, setCurrentModel] = useState<'vosk' | 'whisper'>('vosk');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionStartRef = useRef<number>(0);
  const metricsHistoryRef = useRef<Metrics[]>([]);

  // Initialize audio context and worklet
  const initializeAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule('/audio-processor.js');

      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor');
      
      workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio' && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data.data);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);
      workletNodeRef.current = workletNode;

      return true;
    } catch (error) {
      console.error('Error initializing audio:', error);
      setStatus('Audio initialization failed');
      return false;
    }
  };

  // Connect to WebSocket
  const connectWebSocket = () => {
    const ws = new WebSocket('ws://localhost:8000/ws/transcribe');
    
    ws.onopen = () => {
      setStatus('Connected');
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'connected') {
        setCurrentModel(data.model);
      } else if (data.type === 'partial' || data.type === 'final') {
        if (data.text) {
          setTranscript((prev) => {
            const newSegment: TranscriptSegment = {
              text: data.text,
              type: data.type,
              timestamp: Date.now(),
            };
            
            if (data.type === 'partial') {
              const filtered = prev.filter(s => s.type === 'final');
              return [...filtered, newSegment];
            } else {
              return [...prev.filter(s => s.type === 'final'), newSegment];
            }
          });
        }
        
        if (data.metrics) {
          setMetrics(data.metrics);
          metricsHistoryRef.current.push(data.metrics);
        }
      } else if (data.type === 'model_switched') {
        setCurrentModel(data.model);
        setStatus(`Switched to ${data.model}`);
      } else if (data.type === 'error') {
        setStatus(`Error: ${data.message}`);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('Connection error');
    };

    ws.onclose = () => {
      setStatus('Disconnected');
      console.log('WebSocket closed');
    };

    wsRef.current = ws;
  };

  // Start recording
  const startRecording = async () => {
    const audioReady = await initializeAudio();
    if (!audioReady) return;

    connectWebSocket();
    setIsRecording(true);
    sessionStartRef.current = Date.now();
    metricsHistoryRef.current = [];
    setTranscript([]);
  };

  // Stop recording
  const stopRecording = () => {
    // Save session data
    const sessionData: SessionData = {
      model: currentModel,
      timestamp: sessionStartRef.current,
      duration: Date.now() - sessionStartRef.current,
      metrics: metricsHistoryRef.current,
      transcript: transcript.map(s => s.text).join(' '),
    };
    
    const sessions = JSON.parse(localStorage.getItem('transcription_sessions') || '[]');
    sessions.push(sessionData);
    localStorage.setItem('transcription_sessions', JSON.stringify(sessions));

    // Cleanup
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setStatus('Stopped');
  };

  // Switch model
  const switchModel = async (model: 'vosk' | 'whisper') => {
    if (isRecording) {
      alert('Stop recording before switching models');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      
      const data = await response.json();
      setCurrentModel(data.model);
      setStatus(`Model set to ${data.model}`);
    } catch (error) {
      console.error('Error switching model:', error);
      setStatus('Failed to switch model');
    }
  };

  // Reset transcript
  const resetTranscript = () => {
    setTranscript([]);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'reset' }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Real-Time Transcription System</h1>
          <p className="text-gray-400">High-accuracy offline speech-to-text with performance monitoring</p>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 shadow-xl">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-4 items-center">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
                  isRecording
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                {isRecording ? 'Stop Recording' : 'Start Recording'}
              </button>

              <button
                onClick={resetTranscript}
                disabled={!isRecording}
                className="flex items-center gap-2 px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <RefreshCw size={18} />
                Reset
              </button>
            </div>

            <div className="flex gap-4 items-center">
              <div className="flex gap-2">
                <button
                  onClick={() => switchModel('vosk')}
                  disabled={isRecording}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    currentModel === 'vosk'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Vosk
                </button>
                <button
                  onClick={() => switchModel('whisper')}
                  disabled={isRecording}
                  className={`px-4 py-2 rounded-lg transition-all ${
                    currentModel === 'whisper'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  Whisper
                </button>
              </div>

              <button
                onClick={() => setShowComparison(!showComparison)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition-all"
              >
                <BarChart3 size={18} />
                {showComparison ? 'Hide' : 'Show'} Comparison
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${
                status === 'Connected' ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span>{status}</span>
            </div>
            <div className="text-gray-400">|</div>
            <div>Model: <span className="font-semibold text-blue-400">{currentModel}</span></div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Transcript */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-lg p-6 shadow-xl min-h-96">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Mic size={20} className="text-blue-400" />
                Live Transcript
              </h2>
              <div className="bg-gray-900 rounded p-4 min-h-80 max-h-96 overflow-y-auto">
                {transcript.length === 0 ? (
                  <p className="text-gray-500 italic">Start recording to see transcript...</p>
                ) : (
                  <div className="space-y-2">
                    {transcript.map((segment, idx) => (
                      <p
                        key={idx}
                        className={`${
                          segment.type === 'partial'
                            ? 'text-gray-400 italic'
                            : 'text-white'
                        }`}
                      >
                        {segment.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div>
            <MetricsDisplay metrics={metrics} isRecording={isRecording} />
          </div>
        </div>

        {/* Comparison View */}
        {showComparison && (
          <div className="mt-6">
            <ComparisonView />
          </div>
        )}
      </div>
    </div>
  );
}