import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { bufferToWave, formatTime } from '@/lib/utils/audio';
import "@/styles/modal.css"; // Ensure standard modal styles are applied

interface PreviewEventDetail {
  audioBlob: Blob;
  source: string;
  mediaType?: 'audio' | 'video';
}

export default function PreviewEditModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [source, setSource] = useState<string>('');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>('audio');
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Edit State
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // --- 1. Event Listeners ---
  useEffect(() => {
    const handleOpen = (e: CustomEvent<PreviewEventDetail>) => {
      setAudioBlob(e.detail.audioBlob);
      setSource(e.detail.source);
      setMediaType(e.detail.mediaType || 'audio');
      setIsOpen(true);
      setStartTime(0);
      setEndTime(0);
      setIsPlaying(false);
      setCurrentTime(0);
    };

    window.addEventListener('open-preview-modal', handleOpen as EventListener);
    return () => window.removeEventListener('open-preview-modal', handleOpen as EventListener);
  }, []);

  // --- 2. Audio Processing ---
  useEffect(() => {
    if (isOpen && audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      if (audioRef.current) audioRef.current.src = url;

      const decodeAudio = async () => {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);

          setAudioBuffer(decodedBuffer);
          setDuration(decodedBuffer.duration);
          setEndTime(decodedBuffer.duration);
        } catch (error) {
          console.error("Error decoding audio:", error);
        }
      };
      decodeAudio();
      return () => URL.revokeObjectURL(url);
    }
  }, [isOpen, audioBlob]);

  // --- 3. Playback Logic ---
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      const currentPos = audio.currentTime;
      setCurrentTime(currentPos);

      // Auto-loop/stop at trim bounds
      if (currentPos >= endTime) {
        if (isPlaying) {
          audio.currentTime = startTime;
          // Optional: Loop automatically
          // audio.play(); 
          // Or pause:
          audio.pause();
          setIsPlaying(false);
        }
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', () => setIsPlaying(false));
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', () => setIsPlaying(false));
    };
  }, [endTime, startTime, isPlaying]);

  // --- 4. Animation Loop ---
  useEffect(() => {
    // We redraw whenever time, play state, or trim points change
    if (audioBuffer) {
      drawWaveform(audioBuffer, isPlaying && audioRef.current ? audioRef.current.currentTime : currentTime);

      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, currentTime, startTime, endTime, audioBuffer]);

  const animate = () => {
    if (audioRef.current && audioBuffer) {
      drawWaveform(audioBuffer, audioRef.current.currentTime);
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  };

  // --- 5. Controls Logic ---
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      if (audio.currentTime < startTime || audio.currentTime >= endTime) {
        audio.currentTime = startTime;
      }
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleStartChange = (val: number) => {
    const newStart = Math.max(0, Math.min(val, endTime - 0.2));
    setStartTime(newStart);
    if (!isPlaying && audioRef.current) audioRef.current.currentTime = newStart;
  };

  const handleEndChange = (val: number) => {
    const newEnd = Math.max(startTime + 0.2, Math.min(val, duration));
    setEndTime(newEnd);
  };

  const nudge = (type: 'start' | 'end', amount: number) => {
    if (type === 'start') handleStartChange(startTime + amount);
    else handleEndChange(endTime + amount);
  };

  const handleSave = async () => {
    if (!audioBuffer) return;
    const sampleRate = audioBuffer.sampleRate;
    const startFrame = Math.floor(startTime * sampleRate);
    const endFrame = Math.floor(endTime * sampleRate);
    const frameCount = endFrame - startFrame;

    if (frameCount <= 0) return;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const newBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, frameCount, sampleRate);

    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      const channelData = audioBuffer.getChannelData(i);
      const newChannelData = newBuffer.getChannelData(i);
      for (let j = 0; j < frameCount; j++) {
        newChannelData[j] = channelData[startFrame + j];
      }
    }

    const trimmedBlob = bufferToWave(newBuffer, frameCount);
    window.dispatchEvent(new CustomEvent('voice-edited', {
      detail: { blob: trimmedBlob, source: source }
    }));
    handleClose();
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsPlaying(false);
    if (audioRef.current) audioRef.current.pause();
  };

  // --- 6. Visualization ---
  const drawWaveform = (buffer: AudioBuffer, playbackPos: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    // High DPI Canvas Scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 160 * dpr; // Taller for better touch target visualization
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    const width = rect.width;
    const height = 160;

    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / (width / 2)); // Draw lines every 2px
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);

    // Calculate pixel positions
    const startX = (startTime / duration) * width;
    const endX = (endTime / duration) * width;
    const playX = (playbackPos / duration) * width;

    // Draw Bars
    const barWidth = 2;
    const gap = 1;

    for (let i = 0; i < width; i += (barWidth + gap)) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(Math.floor(i) * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      // Logic for bar Color/Opacity
      let isActive = i >= startX && i <= endX;
      let isPlayed = i <= playX && isActive;

      if (isActive) {
        ctx.fillStyle = isPlayed ? 'var(--orange-9)' : 'var(--orange-11)';
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'var(--orange-11)';
        ctx.globalAlpha = 0.3; // Dim trimmed areas
      }

      const barHeight = Math.max(2, (max - min) * amp);
      const y = (height - barHeight) / 2;

      // Rounded bars
      ctx.beginPath();
      ctx.roundRect(i, y, barWidth, barHeight, 2);
      ctx.fill();
    }

    // Playhead Line
    if (playX >= startX && playX <= endX) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'var(--orange-9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-wide">

        {/* Mobile Handle */}
        <div className="modal-handle-bar">
          <div className="modal-handle-pill"></div>
        </div>

        <div className="modal-header">
          <div className="modal-title-group">
            <Icon icon="lucide:scissors" width={20} height={20} style={{ color: 'var(--orange-9)' }} />
            <h3 className="modal-title">Edit Audio</h3>
          </div>
          <button className="modal-close" onClick={handleClose}>
            <Icon icon="lucide:x" width={20} height={20} />
          </button>
        </div>

        <div className="modal-body">
          {mediaType === 'video' ? (
            <video
              ref={(el) => {
                setVideoElement(el);
                if (el && audioBlob) el.src = URL.createObjectURL(audioBlob);
              }}
              controls
              style={{ width: '100%', borderRadius: 'var(--radius-m)' }}
            />
          ) : (
            <audio ref={audioRef} />
          )}

          <div className="waveform-container">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: '160px', display: 'block' }}
            />
            {/* Range Sliders overlay */}
            <div className="range-stack">
              <input
                type="range"
                className="range-input"
                min="0"
                max={duration}
                step="0.01"
                value={startTime}
                onChange={(e) => handleStartChange(parseFloat(e.target.value))}
              />
              <input
                type="range"
                className="range-input"
                min="0"
                max={duration}
                step="0.01"
                value={endTime}
                onChange={(e) => handleEndChange(parseFloat(e.target.value))}
              />
            </div>
          </div>

          {/* Control Deck */}
          <div className="control-deck">
            {/* Start Controls */}
            <div className="trim-group">
              <span className="trim-label">Start</span>
              <div className="nudge-controls">
                <button className="btn-nudge" onClick={() => nudge('start', -0.1)}>
                  <Icon icon="lucide:chevron-left" width={16} />
                </button>
                <div className="time-readout">{formatTime(startTime)}</div>
                <button className="btn-nudge" onClick={() => nudge('start', 0.1)}>
                  <Icon icon="lucide:chevron-right" width={16} />
                </button>
              </div>
            </div>

            {/* Play Button */}
            <button className="play-fab" onClick={togglePlay}>
              <Icon icon={isPlaying ? 'lucide:pause' : 'lucide:play'} width={28} height={28} style={{ marginLeft: isPlaying ? 0 : 4 }} />
            </button>

            {/* End Controls */}
            <div className="trim-group">
              <span className="trim-label">End</span>
              <div className="nudge-controls">
                <button className="btn-nudge" onClick={() => nudge('end', -0.1)}>
                  <Icon icon="lucide:chevron-left" width={16} />
                </button>
                <div className="time-readout">{formatTime(endTime)}</div>
                <button className="btn-nudge" onClick={() => nudge('end', 0.1)}>
                  <Icon icon="lucide:chevron-right" width={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Footer Action */}
          <button
            className="btn btn-primary btn-full"
            onClick={handleSave}
            style={{ marginTop: 'auto', padding: '14px' }}
          >
            Save & Use Clip
          </button>
        </div>
      </div>
    </div>
  );
}