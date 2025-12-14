import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { bufferToWave, formatTime } from '@/lib/utils/audio';
import "@/styles/modal.css";

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

  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Edit State
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  // CHANGED: Renamed to mediaRef to handle both <audio> and <video>
  const mediaRef = useRef<HTMLMediaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

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

  useEffect(() => {
    if (isOpen && audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      if (mediaRef.current) mediaRef.current.src = url;

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

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const updateTime = () => {
      const currentPos = media.currentTime;
      setCurrentTime(currentPos);

      // Auto-pause at end of trim selection
      if (currentPos >= endTime) {
        if (isPlaying) {
          media.pause();
          setIsPlaying(false);
          media.currentTime = startTime;
        }
      }
    };

    media.addEventListener('timeupdate', updateTime);
    media.addEventListener('ended', () => setIsPlaying(false));
    return () => {
      media.removeEventListener('timeupdate', updateTime);
      media.removeEventListener('ended', () => setIsPlaying(false));
    };
  }, [endTime, startTime, isPlaying]);

  useEffect(() => {
    if (audioBuffer) {
      drawWaveform(audioBuffer, isPlaying && mediaRef.current ? mediaRef.current.currentTime : currentTime);
      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, currentTime, startTime, endTime, audioBuffer]);

  const animate = () => {
    if (mediaRef.current && audioBuffer) {
      drawWaveform(audioBuffer, mediaRef.current.currentTime);
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  };

  const togglePlay = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (isPlaying) {
      media.pause();
    } else {
      if (media.currentTime < startTime || media.currentTime >= endTime) {
        media.currentTime = startTime;
      }
      media.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleStartChange = (val: number) => {
    const newStart = Math.max(0, Math.min(val, endTime - 0.5));
    setStartTime(newStart);
    if (!isPlaying && mediaRef.current) mediaRef.current.currentTime = newStart;
  };

  const handleEndChange = (val: number) => {
    const newEnd = Math.max(startTime + 0.5, Math.min(val, duration));
    setEndTime(newEnd);
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
    if (mediaRef.current) mediaRef.current.pause();
  };

  const drawWaveform = (buffer: AudioBuffer, playbackPos: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 180 * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = 180;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / (width / 2.5));
    const amp = height / 1.5;

    ctx.clearRect(0, 0, width, height);
    const startX = (startTime / duration) * width;
    const endX = (endTime / duration) * width;
    const playX = (playbackPos / duration) * width;

    // 1. Draw Inactive Background
    ctx.fillStyle = 'var(--orange-11)';
    ctx.globalAlpha = 0.2;
    drawBars(ctx, data, step, amp, width, height, 0, width);

    // 2. Draw Active Selection
    ctx.fillStyle = 'var(--orange-9)';
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, 0, endX - startX, height);
    ctx.clip();
    drawBars(ctx, data, step, amp, width, height, 0, width);
    ctx.restore();

    // 3. Draw Playhead
    if (playX >= startX && playX <= endX) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.roundRect(playX - 1.5, 10, 3, height - 20, 4);
      ctx.fill();
    }
  };

  const drawBars = (ctx: CanvasRenderingContext2D, data: Float32Array, step: number, amp: number, width: number, height: number, rangeStart: number, rangeEnd: number) => {
    const barWidth = 3;
    const gap = 2;
    for (let i = rangeStart; i < rangeEnd; i += (barWidth + gap)) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(Math.floor(i) * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      const barHeight = Math.max(4, (max - min) * amp);
      const y = (height - barHeight) / 2;
      ctx.beginPath();
      ctx.roundRect(i, y, barWidth, barHeight, 50);
      ctx.fill();
    }
  };

  const leftPos = duration > 0 ? (startTime / duration) * 100 : 0;
  const rightPos = duration > 0 ? ((duration - endTime) / duration) * 100 : 0;
  const timeRemaining = Math.max(0, endTime - currentTime);

  if (!isOpen) return null;

  return (
    <div className="ios-modal-overlay">
      <div className="ios-modal-card">

        <div className="ios-header">
          <button className="ios-btn-text" onClick={handleClose}>Cancel</button>
          <span className="ios-title">Trim {mediaType === 'video' ? 'Video' : 'Audio'}</span>
          <button className="ios-btn-text bold" onClick={handleSave}>Save</button>
        </div>

        <div className="ios-body">
          {/* VISUALIZER SECTION */}
          {mediaType === 'video' ? (
            /* Video Mode: Show Video Player */
            <div className="ios-video-container">
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                className="ios-video-element"
                playsInline
                muted={false} // Ensure sound is on so they can hear what they trim
              />
              {/* Optional small timer for video mode since the big one is gone */}
              <div className="ios-video-timer">-{formatTime(timeRemaining)}</div>
            </div>
          ) : (
            /* Audio Mode: Show Big Timer + Hidden Audio Element */
            <>
              <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} />
              <div className="ios-time-display">
                -{formatTime(timeRemaining)}
              </div>
            </>
          )}

          {/* CONTROLS SECTION */}
          <div className="ios-waveform-area" style={{ marginTop: mediaType === 'video' ? '20px' : '0' }}>
            <canvas ref={canvasRef} className="ios-canvas" />
            <div className="ios-trim-overlay" style={{ left: `${leftPos}%`, right: `${rightPos}%` }} />
            <div className="ios-range-stack">
              <input type="range" className="ios-range-input left-thumb" min="0" max={duration} step="0.01" value={startTime} onChange={(e) => handleStartChange(parseFloat(e.target.value))} />
              <input type="range" className="ios-range-input right-thumb" min="0" max={duration} step="0.01" value={endTime} onChange={(e) => handleEndChange(parseFloat(e.target.value))} />
            </div>
          </div>

          <div className="ios-controls">
            <div className="ios-helper-text">Drag yellow handles to trim</div>
            <button className="ios-play-btn" onClick={togglePlay}>
              <Icon icon={isPlaying ? 'lucide:pause' : 'lucide:play'} width={32} height={32} style={{ marginLeft: isPlaying ? 0 : 4, color: 'white' }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}