-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin', 'management')),
  department TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  force_password_change BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers table
CREATE TABLE customers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  account_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Callbacks table
CREATE TABLE callbacks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES profiles(id) NOT NULL,
  created_by UUID REFERENCES profiles(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  query_description TEXT NOT NULL,
  possible_solution TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'rescheduled')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follow-ups and escalations table
CREATE TABLE followups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES profiles(id) NOT NULL,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  type TEXT DEFAULT 'followup' CHECK (type IN ('followup', 'escalation')),
  query_description TEXT NOT NULL,
  possible_solution TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date TIMESTAMPTZ,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id),
  followup_id UUID REFERENCES followups(id) ON DELETE CASCADE,
  callback_id UUID REFERENCES callbacks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'followup', 'escalation', 'reminder', 'request', 'callback')),
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Password reset requests
CREATE TABLE password_reset_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER callbacks_updated_at BEFORE UPDATE ON callbacks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER followups_updated_at BEFORE UPDATE ON followups FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'agent')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Profiles viewable by authenticated users" ON profiles FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins can update any profile" ON profiles FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can insert profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Customers policies
CREATE POLICY "All users see all customers" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Agents can insert customers" ON customers FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Agents can update their customers" ON customers FOR UPDATE TO authenticated USING (
  created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Callbacks policies
CREATE POLICY "Agents see their own callbacks" ON callbacks FOR SELECT TO authenticated USING (
  agent_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can insert callbacks" ON callbacks FOR INSERT TO authenticated WITH CHECK (
  agent_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Agents can update their callbacks" ON callbacks FOR UPDATE TO authenticated USING (
  agent_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Followups policies
CREATE POLICY "Agents see assigned followups" ON followups FOR SELECT TO authenticated USING (
  agent_id = auth.uid() OR created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Authenticated users can insert followups" ON followups FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Agents update assigned followups" ON followups FOR UPDATE TO authenticated USING (
  agent_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Password reset request policies
CREATE POLICY "Admins see all reset requests" ON password_reset_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users see own reset requests" ON password_reset_requests FOR SELECT TO authenticated USING (
  profile_id = auth.uid()
);

-- Notifications policies
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT TO authenticated USING (recipient_id = auth.uid());
CREATE POLICY "Authenticated users can insert notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE TO authenticated USING (recipient_id = auth.uid());
