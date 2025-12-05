'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { Trash2, Download } from 'lucide-react';

interface Metrics {
  cpu_percent: number;
  memory_mb: number;
  avg_chunk_time_ms: number;
  rtf: number;
}

interface SessionData {
  model: string;
  timestamp: number;
  duration: number;
  metrics: Metrics[];
  transcript: string;
}

export default function ComparisonView() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<number[]>([]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = () => {
    const stored = localStorage.getItem('transcription_sessions');
    if (stored) {
      const parsed = JSON.parse(stored);
      setSessions(parsed);
      // Auto-select last two sessions if available
      if (parsed.length >= 2) {
        setSelectedSessions([parsed.length - 2, parsed.length - 1]);
      } else if (parsed.length === 1) {
        setSelectedSessions([0]);
      }
    }
  };

  const clearSessions = () => {
    if (confirm('Are you sure you want to clear all session data?')) {
      localStorage.removeItem('transcription_sessions');
      setSessions([]);
      setSelectedSessions([]);
    }
  };

  const exportData = () => {
    const dataStr = JSON.stringify(sessions, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transcription-sessions-${Date.now()}.json`;
    link.click();
  };

  const toggleSession = (index: number) => {
    setSelectedSessions(prev => {
      if (prev.includes(index)) {
        return prev.filter(i => i !== index);
      } else {
        return [...prev, index].slice(-2); // Keep max 2 sessions
      }
    });
  };

  const getAverageMetrics = (session: SessionData) => {
    if (session.metrics.length === 0) return null;
    
    const sum = session.metrics.reduce(
      (acc, m) => ({
        cpu: acc.cpu + m.cpu_percent,
        memory: acc.memory + m.memory_mb,
        chunkTime: acc.chunkTime + m.avg_chunk_time_ms,
        rtf: acc.rtf + m.rtf,
      }),
      { cpu: 0, memory: 0, chunkTime: 0, rtf: 0 }
    );

    const count = session.metrics.length;
    return {
      avgCPU: sum.cpu / count,
      avgMemory: sum.memory / count,
      avgChunkTime: sum.chunkTime / count,
      avgRTF: sum.rtf / count,
    };
  };

  if (sessions.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
        <h2 className="text-xl font-semibold mb-4">Model Comparison</h2>
        <div className="text-center text-gray-500 py-12">
          <p>No session data available yet.</p>
          <p className="text-sm mt-2">Record sessions with different models to compare performance.</p>
        </div>
      </div>
    );
  }

  const comparisonData = selectedSessions.map(idx => {
    const session = sessions[idx];
    const avg = getAverageMetrics(session);
    return {
      name: `${session.model} (${new Date(session.timestamp).toLocaleTimeString()})`,
      model: session.model,
      ...avg,
    };
  }).filter(d => d.avgCPU !== undefined);

  return (
    <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Model Comparison</h2>
        <div className="flex gap-2">
          <button
            onClick={exportData}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition-all"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={clearSessions}
            className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition-all"
          >
            <Trash2 size={16} />
            Clear All
          </button>
        </div>
      </div>

      {/* Session Selector */}
      <div className="mb-6">
        <h3 className="text-sm font-medium mb-3 text-gray-300">Select Sessions to Compare (max 2):</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sessions.map((session, idx) => {
            const avg = getAverageMetrics(session);
            return (
              <button
                key={idx}
                onClick={() => toggleSession(idx)}
                className={`p-4 rounded-lg text-left transition-all ${
                  selectedSessions.includes(idx)
                    ? 'bg-blue-600 border-2 border-blue-400'
                    : 'bg-gray-700 hover:bg-gray-600 border-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold capitalize">{session.model}</span>
                  <span className="text-xs text-gray-300">
                    {new Date(session.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {avg && (
                  <div className="text-xs space-y-1 text-gray-300">
                    <div>RTF: {avg.avgRTF.toFixed(3)}x</div>
                    <div>CPU: {avg.avgCPU.toFixed(1)}%</div>
                    <div>Duration: {(session.duration / 1000).toFixed(0)}s</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {comparisonData.length > 0 && (
        <>
          {/* Bar Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* RTF Comparison */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">Real-Time Factor (Lower is Better)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="model" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '0.5rem' }}
                  />
                  <Bar dataKey="avgRTF" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-gray-400 mt-2">Target: &lt; 1.0 for real-time</p>
            </div>

            {/* CPU Comparison */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">Average CPU Usage</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="model" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '0.5rem' }}
                  />
                  <Bar dataKey="avgCPU" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Memory Comparison */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">Average Memory Usage (MB)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="model" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '0.5rem' }}
                  />
                  <Bar dataKey="avgMemory" fill="#8B5CF6" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chunk Time Comparison */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-3">Average Chunk Processing Time (ms)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="model" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '0.5rem' }}
                  />
                  <Bar dataKey="avgChunkTime" fill="#F59E0B" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Detailed Comparison Table */}
          <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">Detailed Metrics</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2 px-3">Model</th>
                  <th className="text-right py-2 px-3">RTF</th>
                  <th className="text-right py-2 px-3">CPU %</th>
                  <th className="text-right py-2 px-3">Memory MB</th>
                  <th className="text-right py-2 px-3">Chunk Time ms</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((data, idx) => (
                  <tr key={idx} className="border-b border-gray-800">
                    <td className="py-2 px-3 font-medium capitalize">{data.model}</td>
                    <td className="text-right py-2 px-3">{data.avgRTF?.toFixed(3)}</td>
                    <td className="text-right py-2 px-3">{data.avgCPU?.toFixed(1)}</td>
                    <td className="text-right py-2 px-3">{data.avgMemory?.toFixed(0)}</td>
                    <td className="text-right py-2 px-3">{data.avgChunkTime?.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

