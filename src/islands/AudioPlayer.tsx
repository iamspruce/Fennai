import { useState, useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import "../styles/AudioPlayer.css"

interface AudioPlayerProps {
  audioUrl?: string;
  audioBlob?: Blob;
  className?: string;
  waveColor?: string;
  progressColor?: string;
}

export default function AudioPlayer({
  audioUrl,
  audioBlob,
  className = '',
  waveColor = '#C1C7D0',
  progressColor = '#4F46E5'
}: AudioPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);

  // Step 1: Load audio source - fix Safari IndexedDB blob issue
  useEffect(() => {
    let mounted = true;

    const loadAudio = async () => {
      try {
        if (audioUrl) {
          console.log('Using direct URL');
          if (mounted) setAudioSrc(audioUrl);
        } else if (audioBlob) {
          console.log('Processing blob...', {
            size: audioBlob.size,
            type: audioBlob.type
          });

          // Safari fix: Create a new Blob from the blob's array buffer
          // This breaks the IndexedDB connection that causes the error
          try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            console.log('Got array buffer:', arrayBuffer.byteLength, 'bytes');

            const newBlob = new Blob([arrayBuffer], { type: audioBlob.type || 'audio/mpeg' });
            console.log('Created new blob:', newBlob.size, 'bytes');

            const reader = new FileReader();
            reader.onloadend = () => {
              if (mounted && reader.result && typeof reader.result === 'string') {
                console.log('Successfully converted to data URL');
                setAudioSrc(reader.result);
              }
            };
            reader.onerror = () => {
              console.error('FileReader error:', reader.error);
              if (mounted) setError('Failed to load audio');
            };
            reader.readAsDataURL(newBlob);
          } catch (blobError) {
            console.error('Blob processing error:', blobError);
            if (mounted) setError('Failed to process audio');
          }
        }
      } catch (err) {
        console.error('Audio loading error:', err);
        if (mounted) setError('Failed to load audio');
      }
    };

    loadAudio();
    return () => { mounted = false; };
  }, [audioUrl, audioBlob]);

  // Step 2: Setup native audio element
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !audioSrc) return;

    console.log('Setting audio source...');
    audioEl.src = audioSrc;
    audioEl.preload = 'metadata';

    const handleLoadedMetadata = () => {
      console.log('Audio loaded successfully, duration:', audioEl.duration);
      setDuration(audioEl.duration);
      setError(null);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audioEl.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    const handleError = () => {
      console.error("Audio playback error:", audioEl.error);
      setError("Playback failed");
    };

    audioEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioEl.addEventListener('timeupdate', handleTimeUpdate);
    audioEl.addEventListener('play', handlePlay);
    audioEl.addEventListener('pause', handlePause);
    audioEl.addEventListener('ended', handleEnded);
    audioEl.addEventListener('error', handleError);

    return () => {
      audioEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audioEl.removeEventListener('timeupdate', handleTimeUpdate);
      audioEl.removeEventListener('play', handlePlay);
      audioEl.removeEventListener('pause', handlePause);
      audioEl.removeEventListener('ended', handleEnded);
      audioEl.removeEventListener('error', handleError);
    };
  }, [audioSrc]);

  // Step 3: Generate waveform data using Web Audio API
  useEffect(() => {
    if (!audioUrl && !audioBlob) return;

    const generateWaveform = async () => {
      try {
        console.log('Generating waveform...');

        // Get ArrayBuffer from source
        let arrayBuffer: ArrayBuffer;
        if (audioUrl) {
          const response = await fetch(audioUrl);
          arrayBuffer = await response.arrayBuffer();
        } else if (audioBlob) {
          // Use the blob directly via arrayBuffer (this works in Safari)
          arrayBuffer = await audioBlob.arrayBuffer();
        } else {
          return;
        }

        console.log('Decoding audio data...');
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        console.log('Audio decoded, extracting waveform...');
        const rawData = audioBuffer.getChannelData(0);
        const samples = 100;
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData: number[] = [];

        for (let i = 0; i < samples; i++) {
          const blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockStart + j]);
          }
          filteredData.push(sum / blockSize);
        }

        const max = Math.max(...filteredData);
        const normalized = filteredData.map(n => n / max);

        console.log('Waveform generated successfully');
        setWaveformData(normalized);

        audioContext.close();
      } catch (err) {
        console.error('Waveform generation error:', err);
        // Fallback waveform
        const fallback = Array(100).fill(0).map(() => Math.random() * 0.5 + 0.3);
        setWaveformData(fallback);
      }
    };

    generateWaveform();
  }, [audioUrl, audioBlob]);

  // Step 4: Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const width = rect.width;
      const height = rect.height;
      const barWidth = width / waveformData.length;
      const progress = duration > 0 ? currentTime / duration : 0;

      ctx.clearRect(0, 0, width, height);

      waveformData.forEach((value, index) => {
        const barHeight = value * height * 0.8;
        const x = index * barWidth;
        const y = (height - barHeight) / 2;

        const barProgress = index / waveformData.length;
        ctx.fillStyle = barProgress <= progress ? progressColor : waveColor;

        ctx.fillRect(x, y, barWidth * 0.5, barHeight);
      });
    };

    draw();

    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
  }, [waveformData, currentTime, duration, waveColor, progressColor]);

  // Animation loop
  useEffect(() => {
    if (isPlaying) {
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate);
      };
      animate();
    } else if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const audioEl = audioRef.current;
    if (!audioEl) return;

    if (isPlaying) {
      audioEl.pause();
    } else {
      audioEl.play().catch(err => {
        console.error("Play error:", err);
        setError("Cannot play audio");
      });
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audioEl = audioRef.current;
    if (!canvas || !audioEl || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    audioEl.currentTime = progress * duration;
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}min ${s > 0 ? `${s}s` : ''}`;
    return `${s}s`;
  };

  return (
    <div className={`audio-player-container ${className}`}>
      <audio ref={audioRef} style={{ display: 'none' }} />

      <button
        className="control-button"
        onClick={togglePlay}
        type="button"
        disabled={!!error || !audioSrc}
      >
        <Icon
          icon={isPlaying ? 'solar:pause-bold' : 'solar:play-bold'}
          className="icon"
        />
      </button>

      <div className="waveform-wrapper">
        {error ? (
          <span style={{ fontSize: '12px', color: '#ef4444' }}>{error}</span>
        ) : (
          <canvas
            ref={canvasRef}
            className="waveform"
            onClick={handleCanvasClick}
            style={{ cursor: 'pointer', width: '100%', height: '40px' }}
          />
        )}
      </div>

      <div className="time-display">
        {isPlaying ? formatTime(currentTime) : formatTime(duration)}
      </div>
    </div>
  );
}