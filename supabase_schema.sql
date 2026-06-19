-- Motion Capture Lab Database Schema
-- Run this SQL in your Supabase SQL Editor to create the required tables

-- Create motion_recordings table
CREATE TABLE IF NOT EXISTS motion_recordings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT DEFAULT 'anonymous',
    name TEXT NOT NULL,
    start_time BIGINT NOT NULL,
    duration BIGINT NOT NULL,
    frame_rate DECIMAL NOT NULL,
    frame_count INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    frames_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_motion_recordings_user_id ON motion_recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_motion_recordings_created_at ON motion_recordings(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE motion_recordings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anonymous users to insert their own recordings
CREATE POLICY "Allow anonymous insert" ON motion_recordings
    FOR INSERT
    WITH CHECK (true);

-- Create policy to allow users to read all recordings (for research/demo purposes)
-- You can modify this to be more restrictive if needed
CREATE POLICY "Allow read all" ON motion_recordings
    FOR SELECT
    USING (true);

-- Create policy to allow users to delete their own recordings
CREATE POLICY "Allow delete own" ON motion_recordings
    FOR DELETE
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub' OR user_id = 'anonymous');

-- Create policy to allow users to update their own recordings
CREATE POLICY "Allow update own" ON motion_recordings
    FOR UPDATE
    USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub' OR user_id = 'anonymous')
    WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json->>'sub' OR user_id = 'anonymous');

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to call the function
CREATE TRIGGER update_motion_recordings_updated_at
    BEFORE UPDATE ON motion_recordings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
