-- Add device tracking columns to profiles table for single device login

-- Add current_device_id column
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS current_device_id VARCHAR(16);

-- Add last_login_at column to track login time
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_current_device_id ON profiles(current_device_id);

-- Optional: Create device_sessions table for audit logging
CREATE TABLE IF NOT EXISTS device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name TEXT,
  device_id VARCHAR(16) NOT NULL,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'invalidated')),
  login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  invalidated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for device_sessions
CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id ON device_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_device_id ON device_sessions(device_id);
