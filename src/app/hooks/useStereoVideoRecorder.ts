import { useCallback, useRef, useState } from 'react';

export interface StereoVideoRecording {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  cam1Blob: Blob;
  cam2Blob: Blob;
  mimeType: string;
}

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? '';
}

export function useStereoVideoRecorder(
  stream1: MediaStream | null,
  stream2: MediaStream | null,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<StereoVideoRecording[]>([]);
  const [error, setError] = useState<string | null>(null);

  const rec1Ref = useRef<MediaRecorder | null>(null);
  const rec2Ref = useRef<MediaRecorder | null>(null);
  const chunks1Ref = useRef<Blob[]>([]);
  const chunks2Ref = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(() => {
    if (!stream1 || !stream2) {
      setError('Both camera streams must be active before recording.');
      return;
    }
    if (isRecording) return;

    const mimeType = pickMimeType();
    const opts = mimeType ? { mimeType } : {};

    try {
      const r1 = new MediaRecorder(stream1, opts);
      const r2 = new MediaRecorder(stream2, opts);

      chunks1Ref.current = [];
      chunks2Ref.current = [];

      r1.ondataavailable = e => { if (e.data.size > 0) chunks1Ref.current.push(e.data); };
      r2.ondataavailable = e => { if (e.data.size > 0) chunks2Ref.current.push(e.data); };

      rec1Ref.current = r1;
      rec2Ref.current = r2;

      // Start both in the same synchronous block — sub-millisecond apart
      startTimeRef.current = Date.now();
      r1.start(100); // collect chunks every 100ms
      r2.start(100);

      setIsRecording(true);
      setError(null);
    } catch (err) {
      setError(`Failed to start recording: ${(err as Error).message}`);
    }
  }, [stream1, stream2, isRecording]);

  const stopRecording = useCallback((): Promise<StereoVideoRecording | null> => {
    return new Promise(resolve => {
      const r1 = rec1Ref.current;
      const r2 = rec2Ref.current;
      if (!r1 || !r2 || !isRecording) { resolve(null); return; }

      const duration = Date.now() - startTimeRef.current;
      let stoppedCount = 0;

      const tryFinalize = () => {
        stoppedCount++;
        if (stoppedCount < 2) return;

        const mimeType = r1.mimeType || 'video/webm';
        const blob1 = new Blob(chunks1Ref.current, { type: mimeType });
        const blob2 = new Blob(chunks2Ref.current, { type: mimeType });

        const recording: StereoVideoRecording = {
          id: `stereo_video_${startTimeRef.current}`,
          name: `StereoCapture_${new Date(startTimeRef.current).toLocaleString()}`,
          startTime: startTimeRef.current,
          duration,
          cam1Blob: blob1,
          cam2Blob: blob2,
          mimeType,
        };

        setRecordings(prev => [recording, ...prev]);
        setIsRecording(false);
        rec1Ref.current = null;
        rec2Ref.current = null;
        resolve(recording);
      };

      r1.onstop = tryFinalize;
      r2.onstop = tryFinalize;

      // Stop both in the same synchronous block
      r1.stop();
      r2.stop();
    });
  }, [isRecording]);

  const downloadRecording = useCallback((recording: StereoVideoRecording) => {
    const ext = recording.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const safeName = recording.name.replace(/[^a-z0-9]/gi, '_');

    for (const [blob, suffix] of [
      [recording.cam1Blob, 'cam1'],
      [recording.cam2Blob, 'cam2'],
    ] as [Blob, string][]) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeName}_${suffix}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, []);

  const deleteRecording = useCallback((id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  }, []);

  return {
    isRecording,
    recordings,
    error,
    startRecording,
    stopRecording,
    downloadRecording,
    deleteRecording,
  };
}
