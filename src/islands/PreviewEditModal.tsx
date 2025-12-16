// src/islands/PreviewEditModal.tsx - Improved version
import { useState, useRef, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import '@/styles/modal.css';

interface PreviewEventDetail {
  audioBlob: Blob;
  source: string;
  mediaType?: 'audio' | 'video';
  characterId?: string;
  text?: string;
  isMultiCharacter?: boolean;
  characterIds?: string[];
  texts?: string[];
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const bufferToWave = (audioBuffer: AudioBuffer, length: number): Blob => {
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * numberOfChannels * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

export default function PreviewEditModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [source, setSource] = useState<string>('');
  const [mediaType, setMediaType] = useState<'audio' | 'video'>('audio');
  const [metadata, setMetadata] = useState<any>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const mediaRef = useRef<HTMLMediaElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<PreviewEventDetail>) => {
      console.log('[PreviewModal] Opening with:', e.detail);

      setAudioBlob(e.detail.audioBlob);
      setSource(e.detail.source);
      setMediaType(e.detail.mediaType || 'audio');
      setMetadata({
        characterId: e.detail.characterId,
        text: e.detail.text,
        isMultiCharacter: e.detail.isMultiCharacter,
        characterIds: e.detail.characterIds,
        texts: e.detail.texts,
      });
      setIsOpen(true);
      setStartTime(0);
      setEndTime(0);
      setIsPlaying(false);
      setCurrentTime(0);
      setIsSaving(false);
    };

    window.addEventListener('open-preview-modal', handleOpen as EventListener);
    return () => window.removeEventListener('open-preview-modal', handleOpen as EventListener);
  }, []);

  useEffect(() => {
    if (isOpen && audioBlob) {
      // Clean up previous URL
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      const url = URL.createObjectURL(audioBlob);
      objectUrlRef.current = url;

      if (mediaRef.current) {
        mediaRef.current.src = url;
        if (mediaType === 'video') {
          mediaRef.current.load();
        }
      }

      const decodeAudio = async () => {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();

          if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }

          const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

          setAudioBuffer(decodedBuffer);
          setDuration(decodedBuffer.duration);
          setEndTime(decodedBuffer.duration);
        } catch (error) {
          console.error('[PreviewModal] Error decoding audio:', error);
        }
      };
      decodeAudio();

      return () => {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      };
    }
  }, [isOpen, audioBlob, mediaType]);

  // Monitor playback and enforce end boundary
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const updateTime = () => {
      const currentPos = media.currentTime;
      setCurrentTime(currentPos);

      // More precise boundary check - pause slightly before end
      if (currentPos >= endTime - 0.05) {
        if (isPlaying) {
          media.pause();
          setIsPlaying(false);
          media.currentTime = startTime;
        }
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (media) media.currentTime = startTime;
    };

    const handleLoadedMetadata = () => {
      // Ensure duration is set for video
      if (mediaType === 'video' && !duration) {
        setDuration(media.duration);
        setEndTime(media.duration);
      }
    };

    media.addEventListener('timeupdate', updateTime);
    media.addEventListener('ended', handleEnded);
    media.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      media.removeEventListener('timeupdate', updateTime);
      media.removeEventListener('ended', handleEnded);
      media.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [endTime, startTime, isPlaying, duration, mediaType]);

  // Waveform animation
  useEffect(() => {
    if (audioBuffer && canvasRef.current) {
      drawWaveform(audioBuffer, isPlaying && mediaRef.current ? mediaRef.current.currentTime : currentTime);

      if (isPlaying) {
        const animate = () => {
          if (mediaRef.current && audioBuffer) {
            drawWaveform(audioBuffer, mediaRef.current.currentTime);
            animationFrameRef.current = requestAnimationFrame(animate);
          }
        };
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, currentTime, startTime, endTime, audioBuffer]);

  const togglePlay = useCallback(async () => {
    const media = mediaRef.current;
    if (!media) return;

    // Wait for any pending play promise to resolve
    if (playPromiseRef.current) {
      try {
        await playPromiseRef.current;
      } catch (err) {
        // Ignore interruption errors
      }
    }

    if (isPlaying) {
      media.pause();
      setIsPlaying(false);
      playPromiseRef.current = null;
    } else {
      // Reset to start if outside bounds
      if (media.currentTime < startTime || media.currentTime >= endTime - 0.05) {
        media.currentTime = startTime;
      }

      const promise = media.play();
      playPromiseRef.current = promise;

      if (promise !== undefined) {
        promise
          .then(() => {
            setIsPlaying(true);
            playPromiseRef.current = null;
          })
          .catch(err => {
            console.error('[PreviewModal] Play failed:', err);
            setIsPlaying(false);
            playPromiseRef.current = null;
          });
      }
    }
  }, [isPlaying, startTime, endTime]);

  const handleStartChange = useCallback((val: number) => {
    const newStart = Math.max(0, Math.min(val, endTime - 0.5));
    setStartTime(newStart);

    // Update playback position if not playing
    if (!isPlaying && mediaRef.current) {
      mediaRef.current.currentTime = newStart;
    }
  }, [endTime, isPlaying]);

  const handleEndChange = useCallback((val: number) => {
    const newEnd = Math.max(startTime + 0.5, Math.min(val, duration));
    setEndTime(newEnd);

    // If current time is beyond new end, seek back
    if (mediaRef.current && mediaRef.current.currentTime > newEnd) {
      mediaRef.current.currentTime = startTime;
    }
  }, [startTime, duration]);

  const handleSave = async () => {
    if (!audioBuffer || isSaving || mediaType === 'video') return;

    setIsSaving(true);

    try {
      const sampleRate = audioBuffer.sampleRate;
      const startFrame = Math.floor(startTime * sampleRate);
      const endFrame = Math.floor(endTime * sampleRate);
      const frameCount = endFrame - startFrame;

      if (frameCount <= 0) {
        throw new Error('Invalid trim selection');
      }

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const newBuffer = audioContextRef.current.createBuffer(
        audioBuffer.numberOfChannels,
        frameCount,
        sampleRate
      );

      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        const channelData = audioBuffer.getChannelData(i);
        const newChannelData = newBuffer.getChannelData(i);
        newChannelData.set(channelData.subarray(startFrame, endFrame));
      }

      const trimmedBlob = bufferToWave(newBuffer, frameCount);

      console.log('[PreviewModal] Dispatching voice-edited event');

      window.dispatchEvent(new CustomEvent('voice-edited', {
        detail: {
          blob: trimmedBlob,
          source: source,
          characterId: metadata?.characterId,
          text: metadata?.text,
          isMultiCharacter: metadata?.isMultiCharacter,
          characterIds: metadata?.characterIds,
          texts: metadata?.texts,
          mediaType: mediaType,
          duration: (endTime - startTime)
        }
      }));

      handleClose();
    } catch (error) {
      console.error('[PreviewModal] Save failed:', error);
      alert('Failed to save trimmed audio. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setIsPlaying(false);

    if (mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.currentTime = 0;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    playPromiseRef.current = null;
  }, []);

  const drawWaveform = useCallback((buffer: AudioBuffer, playbackPos: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();

    if (canvas.width !== rect.width * dpr || canvas.height !== 180 * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = 180 * dpr;
    }

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = 180;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / (width / 2.5));
    const amp = height / 1.5;

    ctx.clearRect(0, 0, width, height);

    const startX = (startTime / duration) * width;
    const endX = (endTime / duration) * width;
    const playX = (playbackPos / duration) * width;

    // Draw inactive waveform
    ctx.fillStyle = 'rgba(255, 128, 0, 0.2)';
    ctx.globalAlpha = 1;
    drawBars(ctx, data, step, amp, width, height, 0, width);

    // Draw active selection
    ctx.fillStyle = 'rgb(255, 128, 0)';
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, 0, endX - startX, height);
    ctx.clip();
    drawBars(ctx, data, step, amp, width, height, 0, width);
    ctx.restore();

    // Draw playhead
    if (playX >= startX && playX <= endX) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.roundRect(playX - 1.5, 10, 3, height - 20, 4);
      ctx.fill();
    }
  }, [startTime, endTime, duration]);

  const drawBars = (
    ctx: CanvasRenderingContext2D,
    data: Float32Array,
    step: number,
    amp: number,
    width: number,
    height: number,
    rangeStart: number,
    rangeEnd: number
  ) => {
    const barWidth = 3;
    const gap = 2;

    for (let i = rangeStart; i < rangeEnd; i += (barWidth + gap)) {
      let min = 1.0;
      let max = -1.0;

      const index = Math.floor(i) * step;
      for (let j = 0; j < step && index + j < data.length; j++) {
        const datum = data[index + j];
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
          <button className="ios-btn-text" onClick={handleClose} disabled={isSaving}>
            Cancel
          </button>
          <span className="ios-title">{mediaType === 'video' ? 'Preview Video' : 'Trim Audio'}</span>
          <button
            className="ios-btn-text bold"
            onClick={handleSave}
            disabled={isSaving || mediaType === 'video'}
            style={{ opacity: mediaType === 'video' ? 0 : 1, pointerEvents: mediaType === 'video' ? 'none' : 'auto' }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div className="ios-body">
          {mediaType === 'video' ? (
            <div className="ios-video-container">
              <video
                ref={mediaRef as React.RefObject<HTMLVideoElement>}
                className="ios-video-element"
                playsInline
                muted={false}
              />
              <div className="ios-video-timer">-{formatTime(timeRemaining)}</div>
            </div>
          ) : (
            <>
              <audio ref={mediaRef as React.RefObject<HTMLAudioElement>} />
              <div className="ios-time-display">
                -{formatTime(timeRemaining)}
              </div>
            </>
          )}

          <div className="ios-waveform-area" style={{ marginTop: mediaType === 'video' ? '20px' : '0' }}>
            <canvas ref={canvasRef} className="ios-canvas" />
            {mediaType === 'audio' && (
              <>
                <div className="ios-trim-overlay" style={{ left: `${leftPos}%`, right: `${rightPos}%` }} />
                <div className="ios-range-stack">
                  <input
                    type="range"
                    className="ios-range-input left-thumb"
                    min="0"
                    max={duration}
                    step="0.01"
                    value={startTime}
                    onChange={(e) => handleStartChange(parseFloat(e.target.value))}
                  />
                  <input
                    type="range"
                    className="ios-range-input right-thumb"
                    min="0"
                    max={duration}
                    step="0.01"
                    value={endTime}
                    onChange={(e) => handleEndChange(parseFloat(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          <div className="ios-controls">
            {mediaType === 'audio' && <div className="ios-helper-text">Drag yellow handles to trim</div>}
            <button className="ios-play-btn" onClick={togglePlay} disabled={isSaving}>
              <Icon
                icon={isPlaying ? 'lucide:pause' : 'lucide:play'}
                width={32}
                height={32}
                style={{ marginLeft: isPlaying ? 0 : 4, color: 'white' }}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}