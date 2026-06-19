import { createClient, SupabaseClient } from '@supabase/supabase-js';

// These environment variables are provided by Make when Supabase is connected
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Check if credentials are available
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn('Supabase credentials not found. Cloud storage features will be disabled. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file to enable cloud sync.');
}

// Create client only if credentials are available, otherwise use a dummy client
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : ({
      from: () => ({
        select: () => Promise.resolve({ data: [], error: new Error('Supabase not configured') }),
        insert: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
        update: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
        delete: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
      }),
    } as any);

// Database types for Motion Capture recordings
export interface Database {
  public: {
    Tables: {
      motion_recordings: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          start_time: number;
          duration: number;
          frame_rate: number;
          frame_count: number;
          metadata: any;
          frames_data: any; // Compressed JSON of all frames
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          name: string;
          start_time: number;
          duration: number;
          frame_rate: number;
          frame_count: number;
          metadata?: any;
          frames_data: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          start_time?: number;
          duration?: number;
          frame_rate?: number;
          frame_count?: number;
          metadata?: any;
          frames_data?: any;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
