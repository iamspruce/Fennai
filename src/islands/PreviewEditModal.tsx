import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { bufferToWave, formatTime } from '@/lib/utils/audio';

interface PreviewEventDetail {
  audioBlob: Blob;
  source: string; // 'create-upload' or 'chat-generate'
}

export default function PreviewEditModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [source, setSource] = useState<string>('');
  
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

  // 1. Listen for open event
  useEffect(() => {
    const handleOpen = (e: CustomEvent<PreviewEventDetail>) => {
      setAudioBlob(e.detail.audioBlob);
      setSource(e.detail.source);
      setIsOpen(true);
      // Reset state
      setStartTime(0);
      setEndTime(0);
      setIsPlaying(false);
      setCurrentTime(0);
    };

    window.addEventListener('open-preview-modal', handleOpen as EventListener);
    return () => window.removeEventListener('open-preview-modal', handleOpen as EventListener);
  }, []);

  // 2. Decode Audio for visualization and editing
  useEffect(() => {
    if (isOpen && audioBlob) {
      const url = URL.createObjectURL(audioBlob);
      if (audioRef.current) audioRef.current.src = url;

      // Decode for waveform and trimming
      const decodeAudio = async () => {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          setAudioBuffer(decodedBuffer);
          setDuration(decodedBuffer.duration);
          setEndTime(decodedBuffer.duration); // Default end to full duration
          drawWaveform(decodedBuffer, 0);
        } catch (error) {
          console.error("Error decoding audio:", error);
        }
      };
      decodeAudio();

      return () => URL.revokeObjectURL(url);
    }
  }, [isOpen, audioBlob]);

  // 3. Audio Player Logic + Waveform Animation
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      const currentPos = audio.currentTime;
      setCurrentTime(currentPos);
      
      // Stop if we reach the "trim end" point during preview
      if (currentPos >= endTime && isPlaying) {
        audio.pause();
        setIsPlaying(false);
        audio.currentTime = startTime;
      }
    };
    
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      if (audioBuffer) drawWaveform(audioBuffer, startTime);
    });
    
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', () => setIsPlaying(false));
    };
  }, [endTime, startTime, isPlaying, audioBuffer, duration]);

  // 4. Animate waveform during playback
  useEffect(() => {
    if (isPlaying && audioBuffer) {
      const animate = () => {
        if (audioRef.current && audioBuffer) {
          drawWaveform(audioBuffer, audioRef.current.currentTime);
        }
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioBuffer) {
        drawWaveform(audioBuffer, currentTime);
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, audioBuffer]);

  // 5. Redraw waveform when trim points change
  useEffect(() => {
    if (audioBuffer && !isPlaying) {
      drawWaveform(audioBuffer, currentTime);
    }
  }, [startTime, endTime]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      // If we are outside the trim bounds, jump to start
      if (audio.currentTime < startTime || audio.currentTime >= endTime) {
        audio.currentTime = startTime;
      }
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  // 6. Waveform Visualization
  const drawWaveform = (buffer: AudioBuffer, playbackPosition: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);

    // Calculate positions in pixels
    const startPixel = (startTime / duration) * width;
    const endPixel = (endTime / duration) * width;
    const playbackPixel = (playbackPosition / duration) * width;

    for (let i = 0; i < width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      
      // Determine color based on position
      let color = '#94a3b8'; // Gray for trimmed sections
      if (i >= startPixel && i <= endPixel) {
        // Active region
        if (playbackPixel >= startPixel && i <= playbackPixel) {
          color = '#ec4899'; // Pink for played portion
        } else {
          color = '#3b82f6'; // Blue for unplayed active portion
        }
      }
      
      ctx.fillStyle = color;
      ctx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    // Draw playback line
    if (playbackPixel >= startPixel && playbackPixel <= endPixel) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playbackPixel, 0);
      ctx.lineTo(playbackPixel, height);
      ctx.stroke();
    }

    // Draw trim markers
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    
    // Start marker
    ctx.beginPath();
    ctx.moveTo(startPixel, 0);
    ctx.lineTo(startPixel, height);
    ctx.stroke();
    
    // End marker
    ctx.beginPath();
    ctx.moveTo(endPixel, 0);
    ctx.lineTo(endPixel, height);
    ctx.stroke();
  };

  // 7. Trimming Logic
  const handleSave = async () => {
    if (!audioBuffer) return;

    // Calculate start/end frames
    const sampleRate = audioBuffer.sampleRate;
    const startFrame = Math.floor(startTime * sampleRate);
    const endFrame = Math.floor(endTime * sampleRate);
    const frameCount = endFrame - startFrame;

    if (frameCount <= 0) return;

    // Create new buffer
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const newBuffer = audioContext.createBuffer(
      audioBuffer.numberOfChannels,
      frameCount,
      sampleRate
    );

    // Copy data
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      const channelData = audioBuffer.getChannelData(i);
      const newChannelData = newBuffer.getChannelData(i);
      for (let j = 0; j < frameCount; j++) {
        newChannelData[j] = channelData[startFrame + j];
      }
    }

    // Convert back to Blob using utility
    const trimmedBlob = bufferToWave(newBuffer, frameCount);

    // Dispatch event with the new file
    window.dispatchEvent(new CustomEvent('voice-edited', {
      detail: { 
        blob: trimmedBlob, 
        source: source 
      }
    }));

    handleClose();
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };



  const handleStartChange = (value: number) => {
    const newStart = Math.max(0, Math.min(value, endTime - 0.1));
    setStartTime(newStart);
    if (audioRef.current && !isPlaying) {
      audioRef.current.currentTime = newStart;
      setCurrentTime(newStart);
    }
  };

  const handleEndChange = (value: number) => {
    const newEnd = Math.max(startTime + 0.1, Math.min(value, duration));
    setEndTime(newEnd);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-wide">
        <div className="modal-header">
          <Icon icon="lucide:scissors" width={24} height={24} style={{ color: 'var(--pink-9)' }} />
          <h3 style={{ margin: 0, marginLeft: '10px' }}>Edit Audio</h3>
          <button className="modal-close" onClick={handleClose}>
            <Icon icon="lucide:x" width={20} height={20} />
          </button>
        </div>

        <div className="preview-body">
          <audio ref={audioRef} />
          
          <div className="waveform-container">
            <canvas 
              ref={canvasRef} 
              width={800} 
              height={120} 
              className="waveform-canvas"
              style={{
                width: '100%',
                borderRadius: '8px'
              }}
            />
          </div>

          <div className="audio-controls" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '15px',
            margin: '20px 0'
          }}>
            <button 
              className="icon-btn" 
              onClick={togglePlay}
              style={{
                padding: '12px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'var(--pink-9)',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Icon icon={isPlaying ? 'lucide:pause' : 'lucide:play'} width={24} height={24} />
            </button>
            <div className="time-display" style={{ fontSize: '14px', fontWeight: '500' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <div className="trim-controls" style={{ marginBottom: '20px' }}>
            <div className="slider-group" style={{ marginBottom: '20px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                <label>Start Time</label>
                <span>{formatTime(startTime)}</span>
              </div>
              <input 
                type="range"
                min="0"
                max={duration}
                step="0.01"
                value={startTime}
                onChange={(e) => handleStartChange(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              />
            </div>

            <div className="slider-group">
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                <label>End Time</label>
                <span>{formatTime(endTime)}</span>
              </div>
              <input 
                type="range"
                min="0"
                max={duration}
                step="0.01"
                value={endTime}
                onChange={(e) => handleEndChange(parseFloat(e.target.value))}
                style={{
                  width: '100%',
                  height: '6px',
                  borderRadius: '3px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>

          <div className="modal-actions" style={{
            display: 'flex',
            gap: '10px',
            justifyContent: 'flex-end'
          }}>
            <button 
              className="btn btn-secondary btn-sm" 
              onClick={handleClose}
            >
              Cancel
            </button>
            <button 
              className="btn btn-primary btn-sm" 
              onClick={handleSave}
            >
              Save & Use
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}