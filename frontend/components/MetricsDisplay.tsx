'use client';

import { Activity, Cpu, Clock, Zap } from 'lucide-react';

interface Metrics {
  cpu_percent: number;
  memory_mb: number;
  avg_chunk_time_ms: number;
  rtf: number;
  processing_time_ms?: number;
}

interface MetricsDisplayProps {
  metrics: Metrics | null;
  isRecording: boolean;
}

export default function MetricsDisplay({ metrics, isRecording }: MetricsDisplayProps) {
  const getStatusColor = (value: number, thresholds: number[]) => {
    if (value < thresholds[0]) return 'text-green-400';
    if (value < thresholds[1]) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getRTFStatus = (rtf: number) => {
    if (rtf < 0.5) return { color: 'text-green-400', label: 'Excellent' };
    if (rtf < 1.0) return { color: 'text-green-400', label: 'Real-time' };
    if (rtf < 1.5) return { color: 'text-yellow-400', label: 'Acceptable' };
    return { color: 'text-red-400', label: 'Slow' };
  };

  if (!isRecording || !metrics) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Activity size={20} className="text-blue-400" />
          Performance Metrics
        </h2>
        <div className="text-center text-gray-500 py-12">
          <Activity size={48} className="mx-auto mb-4 opacity-50" />
          <p>Start recording to see metrics</p>
        </div>
      </div>
    );
  }

  const rtfStatus = getRTFStatus(metrics.rtf);

  return (
    <div className="bg-gray-800 rounded-lg p-6 shadow-xl">
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <Activity size={20} className="text-blue-400" />
        Performance Metrics
      </h2>

      <div className="space-y-4">
        {/* CPU Usage */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-blue-400" />
              <span className="text-sm font-medium">CPU Usage</span>
            </div>
            <span className={`text-lg font-bold ${getStatusColor(metrics.cpu_percent, [50, 80])}`}>
              {metrics.cpu_percent}%
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(metrics.cpu_percent, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-green-400" />
              <span className="text-sm font-medium">Memory</span>
            </div>
            <span className={`text-lg font-bold ${getStatusColor(metrics.memory_mb, [500, 1000])}`}>
              {metrics.memory_mb.toFixed(0)} MB
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.min((metrics.memory_mb / 2000) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Processing Time */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-purple-400" />
              <span className="text-sm font-medium">Chunk Time</span>
            </div>
            <span className={`text-lg font-bold ${getStatusColor(metrics.avg_chunk_time_ms, [100, 200])}`}>
              {metrics.avg_chunk_time_ms.toFixed(1)} ms
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Last: {metrics.processing_time_ms?.toFixed(1) || 0} ms
          </div>
        </div>

        {/* Real-Time Factor */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-yellow-400" />
              <span className="text-sm font-medium">Real-Time Factor</span>
            </div>
            <span className={`text-lg font-bold ${rtfStatus.color}`}>
              {metrics.rtf.toFixed(3)}x
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            Status: <span className={rtfStatus.color}>{rtfStatus.label}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {metrics.rtf < 1.0 ? 'Faster than real-time' : 'Slower than real-time'}
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-900 bg-opacity-30 rounded-lg p-3 mt-4">
          <p className="text-xs text-gray-300">
            <strong>RTF &lt; 1.0:</strong> Real-time performance achieved
            <br />
            <strong>Lower is better:</strong> 0.5x = 2x faster than real-time
          </p>
        </div>
      </div>
    </div>
  );
}
