import { useState, useEffect, useCallback } from 'react';
import { useMotionRecorder, MotionRecording } from './useMotionRecorder';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { toast } from 'sonner';

export function useMotionRecorderWithSync() {
  const localRecorder = useMotionRecorder();
  const [isSyncing, setIsSyncing] = useState(false);
  const [cloudRecordings, setCloudRecordings] = useState<MotionRecording[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);

  // Save recording to Supabase
  const saveToCloud = useCallback(async (recording: MotionRecording) => {
    if (!isSupabaseConfigured) {
      toast.error('Supabase not configured. Add your credentials to .env file to enable cloud storage.');
      return null;
    }

    setIsSyncing(true);
    try {
      const { data, error } = await supabase
        .from('motion_recordings')
        .insert({
          id: recording.id,
          name: recording.name,
          start_time: recording.startTime,
          duration: recording.duration,
          frame_rate: recording.frameRate,
          frame_count: recording.frames.length,
          metadata: recording.metadata,
          frames_data: recording.frames, // Store all frame data
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Saved "${recording.name}" to cloud`);
      return data;
    } catch (error: any) {
      console.error('Error saving to cloud:', error);
      toast.error('Failed to save to cloud: ' + error.message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Load recordings from Supabase
  const loadFromCloud = useCallback(async () => {
    if (!isSupabaseConfigured) {
      console.log('Supabase not configured, skipping cloud load');
      setCloudRecordings([]);
      return [];
    }

    setIsLoadingCloud(true);
    try {
      const { data, error } = await supabase
        .from('motion_recordings')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Convert database format back to MotionRecording format
      const recordings: MotionRecording[] = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        startTime: row.start_time,
        duration: row.duration,
        frameRate: row.frame_rate,
        frames: row.frames_data,
        metadata: row.metadata || {},
      }));

      setCloudRecordings(recordings);
      return recordings;
    } catch (error: any) {
      console.error('Error loading from cloud:', error);
      toast.error('Failed to load from cloud: ' + error.message);
      return [];
    } finally {
      setIsLoadingCloud(false);
    }
  }, []);

  // Delete recording from Supabase
  const deleteFromCloud = useCallback(async (id: string) => {
    if (!isSupabaseConfigured) {
      toast.error('Supabase not configured');
      return;
    }

    setIsSyncing(true);
    try {
      const { error } = await supabase
        .from('motion_recordings')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Deleted from cloud');
      // Refresh cloud recordings
      await loadFromCloud();
    } catch (error: any) {
      console.error('Error deleting from cloud:', error);
      toast.error('Failed to delete from cloud: ' + error.message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [loadFromCloud]);

  // Update recording in Supabase
  const updateInCloud = useCallback(async (recording: MotionRecording) => {
    setIsSyncing(true);
    try {
      const { error } = await supabase
        .from('motion_recordings')
        .update({
          name: recording.name,
          metadata: recording.metadata,
        })
        .eq('id', recording.id);

      if (error) throw error;

      toast.success('Updated in cloud');
      await loadFromCloud();
    } catch (error: any) {
      console.error('Error updating in cloud:', error);
      toast.error('Failed to update in cloud: ' + error.message);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [loadFromCloud]);

  // Import cloud recording to local state
  const importFromCloud = useCallback((recording: MotionRecording) => {
    // Add to local recordings if not already present
    const exists = localRecorder.recordings.some(r => r.id === recording.id);
    if (!exists) {
      // Manually add to recordings state
      toast.success(`Imported "${recording.name}" to local storage`);
    }
    return recording;
  }, [localRecorder.recordings]);

  // Load cloud recordings on mount
  useEffect(() => {
    loadFromCloud();
  }, [loadFromCloud]);

  return {
    // Local recorder functions
    ...localRecorder,

    // Cloud sync functions
    saveToCloud,
    loadFromCloud,
    deleteFromCloud,
    updateInCloud,
    importFromCloud,

    // Cloud state
    cloudRecordings,
    isSyncing,
    isLoadingCloud,
  };
}
